package cz.cointrack.fio

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Klient pro Fio Bank REST API (https://www.fio.cz/ib_api/rest).
 *
 * Endpointy:
 *   - GET /v1/rest/last/{token}/transactions.json     — od last-id pro deduplikaci
 *   - GET /v1/rest/periods/{token}/{from}/{to}/...    — pro range
 *   - GET /v1/rest/set-last-id/{token}/{id}/          — nastav cursor
 */
class FioClient {

    private val baseUrl = "https://fioapi.fio.cz/v1/rest"

    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }

    private val http = HttpClient(CIO) {
        install(ContentNegotiation) { json(json) }
        engine {
            requestTimeout = 60_000
        }
    }

    /**
     * Stáhne transakce od posledního zpracovaného movement_id.
     * První volání po `setLastId` vrátí všechny od toho ID dál.
     * Pokud uživatel ještě nikdy `setLastId` nezavolal, Fio vrátí chybu.
     */
    suspend fun fetchLast(token: String): FioStatement {
        val resp = http.get("$baseUrl/last/$token/transactions.json")
        if (!resp.status.isSuccess()) {
            throw FioException(
                "Fio API HTTP ${resp.status.value}: ${resp.bodyAsText().take(200)}",
                resp.status,
            )
        }
        return resp.body()
    }

    /** Stáhne transakce v daném datovém rozsahu (yyyy-MM-dd). */
    suspend fun fetchPeriod(token: String, from: String, to: String): FioStatement {
        val resp = http.get("$baseUrl/periods/$token/$from/$to/transactions.json")
        if (!resp.status.isSuccess()) {
            throw FioException(
                "Fio API HTTP ${resp.status.value}: ${resp.bodyAsText().take(200)}",
                resp.status,
            )
        }
        return resp.body()
    }

    /** Nastaví cursor — další `fetchLast` vrátí jen tx s ID > zadané. */
    suspend fun setLastId(token: String, id: Long) {
        val resp = http.get("$baseUrl/set-last-id/$token/$id/")
        if (!resp.status.isSuccess()) {
            throw FioException(
                "Fio API set-last-id HTTP ${resp.status.value}: ${resp.bodyAsText().take(200)}",
                resp.status,
            )
        }
    }

    fun close() {
        http.close()
    }

    private fun HttpStatusCode.isSuccess(): Boolean = value in 200..299

    // ── Response DTO ──────────────────────────────────────────────────────────
    @Serializable
    data class FioStatement(
        val accountStatement: AccountStatement = AccountStatement(),
    )

    @Serializable
    data class AccountStatement(
        val info: AccountInfo = AccountInfo(),
        val transactionList: TransactionList = TransactionList(),
    )

    @Serializable
    data class AccountInfo(
        val accountId: String? = null,
        val bankId: String? = null,
        val currency: String? = null,
        val iban: String? = null,
        val bic: String? = null,
        val openingBalance: Double? = null,
        val closingBalance: Double? = null,
        val dateStart: String? = null,
        val dateEnd: String? = null,
        val idFrom: Long? = null,
        val idTo: Long? = null,
    )

    @Serializable
    data class TransactionList(
        val transaction: List<FioTransaction> = emptyList(),
    )

    /**
     * Fio API vrací každou tx jako mapu `column*` polí (column0..column26).
     * Klíčové sloupce:
     *   column22 = ID pohybu
     *   column0  = Datum
     *   column1  = Objem
     *   column14 = Měna
     *   column2  = Protiúčet
     *   column3  = Kód banky
     *   column4  = KS
     *   column5  = VS
     *   column6  = SS
     *   column10 = Název protiúčtu
     *   column16 = Typ pohybu
     *   column25 = Komentář
     *   column26 = BIC
     */
    @Serializable
    data class FioTransaction(
        @SerialName("column22") val movementId: ColumnLong? = null,
        @SerialName("column0")  val date: ColumnString? = null,
        @SerialName("column1")  val amount: ColumnDouble? = null,
        @SerialName("column14") val currency: ColumnString? = null,
        @SerialName("column2")  val counterAccount: ColumnString? = null,
        @SerialName("column3")  val bankCode: ColumnString? = null,
        @SerialName("column4")  val konstSymbol: ColumnString? = null,
        @SerialName("column5")  val varSymbol: ColumnString? = null,
        @SerialName("column6")  val specSymbol: ColumnString? = null,
        @SerialName("column10") val counterAccountName: ColumnString? = null,
        @SerialName("column16") val type: ColumnString? = null,
        @SerialName("column25") val note: ColumnString? = null,
        @SerialName("column26") val bic: ColumnString? = null,
    )

    @Serializable data class ColumnString(val value: String? = null, val name: String? = null, val id: Int? = null)
    @Serializable data class ColumnDouble(val value: Double? = null, val name: String? = null, val id: Int? = null)
    @Serializable data class ColumnLong(val value: Long? = null, val name: String? = null, val id: Int? = null)
}

class FioException(message: String, val status: HttpStatusCode? = null) : RuntimeException(message)
