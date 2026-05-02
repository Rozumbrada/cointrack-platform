package cz.cointrack.email.inbox

import cz.cointrack.ai.GeminiProxyService
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.slf4j.LoggerFactory
import java.util.Base64

/**
 * Server-side OCR pro emailové zprávy.
 *
 * Vstup: subject + body text + přílohy (binární data + mimeType).
 * AI dostane vše naráz a rozhodne:
 *   1) Je tohle vůbec faktura? Pokud ne → vrátí null.
 *   2) Pokud ano, extrahuje stejná pole jako web/mobile DocumentDialog
 *      (merchant/supplier identity, IČO, DIČ, adresa, items, totals, VS,
 *      bank account).
 *
 * Faktura může být:
 *  - Přímo PDF příloha
 *  - Image scan (JPG/PNG)
 *  - Inline v textu emailu (částka + číslo faktury + dodavatel; AI to extrahuje)
 *  - Odkaz v textu emailu (TODO Phase 2 — zatím signal pro user, že tady je odkaz)
 */
class EmailGeminiOcr(private val gemini: GeminiProxyService) {

    private val log = LoggerFactory.getLogger(EmailGeminiOcr::class.java)
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    /** Vstup pro extrakci. */
    data class Input(
        val emailSubject: String?,
        val emailBody: String?,                              // plain text z bodyu (HTML→plain je vyřízeno volajícím)
        val attachments: List<Attachment>,                   // PDF/JPG/PNG/HEIC
    )

    data class Attachment(
        val filename: String,
        val mimeType: String,
        val bytes: ByteArray,
    )

    suspend fun extract(input: Input): ParsedEmailInvoice? {
        // Pokud nemáme co poslat (žádné přílohy ani text), vrať null
        if (input.attachments.isEmpty() && input.emailBody.isNullOrBlank()) return null

        // Build Gemini request — `contents.parts[]` se inlineData pro každou přílohu + text prompt
        val parts = buildJsonArray {
            // Přílohy jako inlineData (base64)
            for (att in input.attachments) {
                add(buildJsonObject {
                    put("inlineData", buildJsonObject {
                        put("mimeType", att.mimeType)
                        put("data", Base64.getEncoder().encodeToString(att.bytes))
                    })
                })
            }
            // Subject + body jako kontext
            val context = buildString {
                appendLine("EMAIL SUBJECT: ${input.emailSubject ?: "(žádný)"}")
                appendLine()
                appendLine("EMAIL BODY:")
                appendLine(input.emailBody?.take(8000) ?: "(prázdné)")  // limit body na 8k znaků
            }
            add(buildJsonObject { put("text", "$context\n\n---\n\n$PROMPT") })
        }

        val body = buildJsonObject {
            put("contents", buildJsonArray {
                add(buildJsonObject { put("parts", parts) })
            })
            put("generationConfig", buildJsonObject {
                put("temperature", 0.1)
                put("responseMimeType", "application/json")
            })
        }

        val (status, raw) = gemini.forwardGenerate("gemini-3.1-flash-lite-preview", body.toString())
        if (status != HttpStatusCode.OK) {
            log.warn("Email OCR Gemini call failed: {} {}", status.value, raw.take(200))
            return null
        }

        // Gemini response: { candidates: [{ content: { parts: [{ text: "<json>" }] } }] }
        val responseJson = runCatching { json.parseToJsonElement(raw) }.getOrNull() ?: return null
        val text = runCatching {
            responseJson.let { it as? kotlinx.serialization.json.JsonObject }
                ?.get("candidates")
                ?.let { it as? kotlinx.serialization.json.JsonArray }
                ?.firstOrNull()
                ?.let { it as? kotlinx.serialization.json.JsonObject }
                ?.get("content")
                ?.let { it as? kotlinx.serialization.json.JsonObject }
                ?.get("parts")
                ?.let { it as? kotlinx.serialization.json.JsonArray }
                ?.firstOrNull()
                ?.let { it as? kotlinx.serialization.json.JsonObject }
                ?.get("text")
                ?.let { it as? kotlinx.serialization.json.JsonPrimitive }
                ?.content
        }.getOrNull() ?: return null

        val cleaned = text
            .removePrefix("```json").removePrefix("```")
            .removeSuffix("```")
            .trim()

        return runCatching {
            json.decodeFromString<ParsedEmailInvoice>(cleaned)
        }.onFailure { log.warn("Failed to parse Gemini email JSON: {}", it.message) }
            .getOrNull()
            ?.takeIf { it.isInvoice }
    }

    private val PROMPT = """
        Jsi expert na rozpoznávání českých faktur z emailové komunikace.

        DOSTAL JSI: subject emailu, plain-text body emailu a 0+ příloh (PDF / JPG / PNG).

        TVŮJ ÚKOL:
        1) Rozhodni, zda email obsahuje fakturu (přijatá nebo vystavená). Faktura = daňový doklad
           s číslem, sumou k úhradě, dodavatelem/odběratelem.
           - Příloha obsahující fakturu → ANO.
           - Body obsahuje strukturované faktury údaje (číslo, suma, IČO, VS) → ANO.
           - Pouhý odkaz na fakturu (např. "Faktura ke stažení v portálu, login zde…") bez extrahovatelných
             dat → izInvoice=true ale s minimálními poli (alespoň supplierName + totalWithVat
             pokud jsou v textu).
           - Reklamní email, newsletter, potvrzení o platbě bez čísla faktury → NE.
        2) Pokud ANO, extrahuj všechna pole. Pokud NE, vrať { "isInvoice": false }.

        VRAŤ POUZE validní JSON (bez markdown, bez vysvětlení):

        {
          "isInvoice": boolean,                          // true pokud email JE faktura nebo ji obsahuje
          "isExpense": boolean,                          // true=přijatá (jsme odběratel), false=vystavená
          "invoiceNumber": string|null,
          "issueDate": "YYYY-MM-DD"|null,
          "dueDate": "YYYY-MM-DD"|null,
          "supplierName": string|null,
          "supplierIco": string|null,                    // PŘESNĚ 8 číslic
          "supplierDic": string|null,                    // CZxxxxxxxx
          "supplierStreet": string|null,
          "supplierCity": string|null,
          "supplierZip": string|null,
          "customerName": string|null,
          "customerIco": string|null,
          "customerDic": string|null,
          "totalWithVat": number|null,
          "totalWithoutVat": number|null,
          "currency": "CZK"|"EUR"|"USD"|null,
          "variableSymbol": string|null,
          "bankAccount": string|null,                    // číslo/kód nebo IBAN
          "bankCode": string|null,                       // 4-číslice (0800, 0100...)
          "paymentMethod": "CASH"|"CARD"|"BANK_TRANSFER"|"OTHER"|null,
          "items": [
            {
              "name": string,
              "quantity": number,
              "totalPrice": number,                      // s DPH
              "vatRate": number                          // 0|10|12|21
            }
          ]
        }

        PRAVIDLA:
        - Pokud hodnota chybí, použij null. Žádné prázdné stringy.
        - Částky desetinná čísla (125.90).
        - IČO 8 číslic (doplň nulami zleva, např. 12345 → "00012345").
        - DIČ s prefixem země (CZxxxxxxxx).
        - isExpense=true pokud nejsme dodavatel (default true; když nejde rozhodnout, použij true).
        - Pokud položky nejsou rozpoznatelné, vrať jednu položku "Faktura" s totalPrice=totalWithVat.
        - Body může být v HTML — interpretuj prosté texty, ignoruj <style>, <script>, navigation odkazy.
    """.trimIndent()
}

@Serializable
data class ParsedEmailInvoice(
    val isInvoice: Boolean = false,
    val isExpense: Boolean = true,
    val invoiceNumber: String? = null,
    val issueDate: String? = null,
    val dueDate: String? = null,

    val supplierName: String? = null,
    val supplierIco: String? = null,
    val supplierDic: String? = null,
    val supplierStreet: String? = null,
    val supplierCity: String? = null,
    val supplierZip: String? = null,

    val customerName: String? = null,
    val customerIco: String? = null,
    val customerDic: String? = null,

    val totalWithVat: Double? = null,
    val totalWithoutVat: Double? = null,
    val currency: String? = null,
    val variableSymbol: String? = null,
    val bankAccount: String? = null,
    val bankCode: String? = null,

    val paymentMethod: String? = null,

    val items: List<ParsedItem> = emptyList(),
)

@Serializable
data class ParsedItem(
    val name: String = "Faktura",
    val quantity: Double = 1.0,
    @SerialName("totalPrice") val totalPrice: Double? = null,
    val vatRate: Int = 21,
)
