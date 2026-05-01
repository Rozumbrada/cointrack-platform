package cz.cointrack.export

import cz.cointrack.db.Accounts
import cz.cointrack.db.InvoiceItems
import cz.cointrack.db.Invoices
import cz.cointrack.db.Profiles
import cz.cointrack.db.ReceiptItems
import cz.cointrack.db.Receipts
import cz.cointrack.db.Transactions
import cz.cointrack.db.db
import org.jetbrains.exposed.dao.id.EntityID
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.selectAll
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate
import java.util.Locale
import java.util.UUID

/**
 * Pohoda XML export — port mobilního ReceiptXmlExporter / BankXmlExporter /
 * InvoiceXmlExporter 1:1.
 *
 * Mobil drží Pohoda XML pravidla (voucher.xsd / bank.xsd / invoice.xsd version_2):
 *  - decimální tečka (Locale.US)
 *  - voucherItem.payVAT vždy false (XSD fixed) → unitPrice je BEZ DPH
 *  - bank.xsd roundingDocument povoluje JEN "none" (banka se nezaokrouhluje)
 *  - voucher/invoice.xsd roundingDocument = "math2one"
 *  - Pohoda enum lowercase (paymentType "cash"|"creditcard"|"draft", rateVAT
 *    "none"|"third"|"low"|"high")
 *  - U neplátce: rateVAT="none", priceNone = celá částka (bez rozpisu DPH)
 */
object PohodaExporter {

    /**
     * Veřejná base URL webu (slouží pro link v poznámce: "Cointrack: {webUrl}/app/receipts/{syncId}").
     * Konfiguruje se přes env `PUBLIC_WEB_URL`. Pokud chybí, link do poznámky se nepřidává.
     */
    private val publicWebUrl: String? get() = System.getenv("PUBLIC_WEB_URL")?.trimEnd('/')?.takeIf { it.isNotBlank() }

    // ═══════════════════════════════════════════════════════════════════
    // RECEIPTS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Vrátí Pohoda XML pro účtenky daného profilu.
     *
     * Hotovostní → voucher (agenda Pokladna), kartové → bank (agenda Banka).
     * Oba typy v jednom dataPacku — Pohoda je při importu zařadí do správné agendy.
     *
     * @param ids Pokud non-null, exportují se JEN tyto účtenky (podle syncId).
     */
    suspend fun exportReceipts(
        profileDbId: UUID,
        from: LocalDate? = null,
        to: LocalDate? = null,
        ids: List<UUID>? = null,
        isVatPayer: Boolean = false,
    ): String = db {
        val profile = Profiles.selectAll().where { Profiles.id eq EntityID(profileDbId, Profiles) }
            .singleOrNull()
        val userIco = profile?.get(Profiles.ico).orEmpty()

        val baseQuery = Receipts.selectAll()
            .where { (Receipts.profileId eq EntityID(profileDbId, Profiles)) and (Receipts.deletedAt eq null) }
            .orderBy(Receipts.date)
            .toList()

        val rows = if (!ids.isNullOrEmpty()) {
            val idSet = ids.toSet()
            baseQuery.filter { it[Receipts.syncId] in idSet }
        } else {
            baseQuery.filter {
                (from == null || !it[Receipts.date].isBefore(from)) &&
                    (to == null || !it[Receipts.date].isAfter(to))
            }
        }

        if (rows.isEmpty()) "" else buildString {
            // Hlavička dataPack — vou + bnk + typ namespace, atributy + ico vlastníka.
            // Note "Export uctenek - Cointrack" matchuje mobile.
            appendLine("""<?xml version="1.0" encoding="UTF-8"?>""")
            appendLine(
                """<dat:dataPack""" +
                    """ xmlns:dat="http://www.stormware.cz/schema/version_2/data.xsd"""" +
                    """ xmlns:vou="http://www.stormware.cz/schema/version_2/voucher.xsd"""" +
                    """ xmlns:bnk="http://www.stormware.cz/schema/version_2/bank.xsd"""" +
                    """ xmlns:typ="http://www.stormware.cz/schema/version_2/type.xsd"""" +
                    """ version="2.0"""" +
                    """ id="Cointrack_${LocalDate.now()}"""" +
                    """ application="Cointrack"""" +
                    """ ico="${userIco.xml()}"""" +
                    """ note="Export uctenek - Cointrack">"""
            )
            rows.forEachIndexed { idx, r ->
                val items = ReceiptItems.selectAll()
                    .where { ReceiptItems.receiptId eq r[Receipts.id] }
                    .orderBy(ReceiptItems.position)
                    .toList()
                val isCard = r[Receipts.paymentMethod] == "CARD"
                if (isCard) {
                    appendBank(this, r, items, idx + 1, isVatPayer)
                } else {
                    appendVoucher(this, r, items, idx + 1, isVatPayer)
                }
            }
            appendLine("</dat:dataPack>")
        }
    }

    // ─── Voucher (cash receipts) ─────────────────────────────────────────

    private fun appendVoucher(sb: StringBuilder, r: ResultRow, items: List<ResultRow>, seq: Int, isVatPayer: Boolean) {
        sb.appendLine("""  <dat:dataPackItem id="$seq" version="2.0">""")
        sb.appendLine("""    <vou:voucher version="2.0">""")
        appendVoucherHeader(sb, r, isVatPayer)
        if (items.isNotEmpty()) appendVoucherDetail(sb, items, isVatPayer)
        appendVoucherSummary(sb, r, items, isVatPayer)
        sb.appendLine("""    </vou:voucher>""")
        sb.appendLine("""  </dat:dataPackItem>""")
    }

    private fun appendVoucherHeader(sb: StringBuilder, r: ResultRow, isVatPayer: Boolean) {
        val merchant = r[Receipts.merchantName].orEmpty().ifBlank { "neznamy obchodnik" }
        val timeSuffix = r[Receipts.time]?.let { " ($it)" }.orEmpty()
        val paymentSuffix = when (r[Receipts.paymentMethod]) {
            "CARD" -> " [karta]"
            "CASH" -> " [hotove]"
            else -> ""
        }
        val vatSuffix = if (!isVatPayer) " [neplatce DPH]" else ""
        val baseText = "Nakup - $merchant$timeSuffix$paymentSuffix$vatSuffix"
        // Pokud má účtenka přiloženou fotku a máme PUBLIC_WEB_URL, přidáme odkaz.
        val photoNote = receiptPhotoUrl(r)
        val text = (if (photoNote != null) "$baseText | Foto: $photoNote" else baseText).take(240)

        sb.appendLine("""      <vou:voucherHeader>""")
        sb.appendLine("""        <vou:voucherType>expense</vou:voucherType>""")
        sb.appendLine("""        <vou:date>${r[Receipts.date]}</vou:date>""")
        sb.appendLine("""        <vou:text>${text.xml()}</vou:text>""")
        appendReceiptPartner(sb, r, "vou")
        sb.appendLine("""      </vou:voucherHeader>""")
    }

    private fun appendVoucherDetail(sb: StringBuilder, items: List<ResultRow>, isVatPayer: Boolean) {
        sb.appendLine("""      <vou:voucherDetail>""")
        items.forEach { item ->
            val name = item[ReceiptItems.name].take(90)
            val qty = item[ReceiptItems.quantity]
            val totalWithVat = item[ReceiptItems.totalPrice]
            val storedUnitWithoutVat = item[ReceiptItems.unitPrice]   // mobile syncuje jako unitPriceWithoutVat
            val vatRate = item[ReceiptItems.vatRate] ?: BigDecimal.ZERO

            val (rateKey, unitPrice) = if (!isVatPayer) {
                // Neplátce: rateVAT=none, unitPrice = total / qty (mobile pattern).
                val unit = if (qty.signum() > 0) totalWithVat.divide(qty, 4, RoundingMode.HALF_UP) else totalWithVat
                "none" to unit
            } else {
                val rate = vatRateToPohoda(vatRate.toInt())
                // Plátce: prefer stored unitPrice (= unitPriceWithoutVat ze sync); fallback na výpočet.
                val unit = storedUnitWithoutVat?.takeIf { it.signum() != 0 }
                    ?: run {
                        val withoutVat = if (vatRate.signum() > 0)
                            totalWithVat.divide(BigDecimal.ONE.add(vatRate.divide(BigDecimal(100))), 4, RoundingMode.HALF_UP)
                        else totalWithVat
                        if (qty.signum() > 0) withoutVat.divide(qty, 4, RoundingMode.HALF_UP) else withoutVat
                    }
                rate to unit
            }
            sb.appendLine("""        <vou:voucherItem>""")
            sb.appendLine("""          <vou:text>${name.xml()}</vou:text>""")
            sb.appendLine("""          <vou:quantity>${qty.fmt(4)}</vou:quantity>""")
            sb.appendLine("""          <vou:payVAT>false</vou:payVAT>""")
            sb.appendLine("""          <vou:rateVAT>$rateKey</vou:rateVAT>""")
            sb.appendLine("""          <vou:homeCurrency>""")
            sb.appendLine("""            <typ:unitPrice>${unitPrice.fmt(2)}</typ:unitPrice>""")
            sb.appendLine("""          </vou:homeCurrency>""")
            sb.appendLine("""        </vou:voucherItem>""")
        }
        sb.appendLine("""      </vou:voucherDetail>""")
    }

    private fun appendVoucherSummary(sb: StringBuilder, r: ResultRow, items: List<ResultRow>, isVatPayer: Boolean) {
        val totals = computeReceiptTotals(r[Receipts.totalWithVat], items, isVatPayer)
        sb.appendLine("""      <vou:voucherSummary>""")
        sb.appendLine("""        <vou:roundingDocument>math2one</vou:roundingDocument>""")
        sb.appendLine("""        <vou:homeCurrency>""")
        appendTotalsLines(sb, totals, "vou")
        sb.appendLine("""        </vou:homeCurrency>""")
        sb.appendLine("""      </vou:voucherSummary>""")
    }

    // ─── Bank (card receipts) ────────────────────────────────────────────

    private fun appendBank(sb: StringBuilder, r: ResultRow, items: List<ResultRow>, seq: Int, isVatPayer: Boolean) {
        // Port z mobile BankXmlExporter.kt 1:1.
        val merchant = r[Receipts.merchantName].orEmpty().ifBlank { "neznamy obchodnik" }
        val timeSuffix = r[Receipts.time]?.let { " ($it)" }.orEmpty()
        val vatSuffix = if (!isVatPayer) " [neplatce DPH]" else ""
        val baseText = "Platba kartou - $merchant$timeSuffix$vatSuffix"
        val photoNote = receiptPhotoUrl(r)
        // bnk:text má string96 — hard limit
        val text = (if (photoNote != null) "$baseText | Foto: $photoNote" else baseText).take(96)

        // V29: Bankovní účet — priorita lookup:
        //   1) Receipts.linkedAccountId (manuální přiřazení web/mobil)
        //   2) Receipts.transactionId → Transactions.accountId (auto-match)
        //   3) profile default BANK account (legacy fallback)
        val pohodaIds = r[Receipts.linkedAccountId]?.let { pohodaIdsForAccount(it.value) }
            ?: r[Receipts.transactionId]?.let { txId ->
                Transactions.selectAll().where { Transactions.id eq txId }.singleOrNull()
                    ?.let { tx -> tx[Transactions.accountId]?.let { pohodaIdsForAccount(it.value) } }
            }
            ?: defaultBankAccountIds(r[Receipts.profileId].value)

        sb.appendLine("""  <dat:dataPackItem id="$seq" version="2.0">""")
        sb.appendLine("""    <bnk:bank version="2.0">""")

        // ── bankHeader ──────────────────────────────────────────────────
        sb.appendLine("""      <bnk:bankHeader>""")
        sb.appendLine("""        <bnk:bankType>expense</bnk:bankType>""")
        sb.appendLine("""        <bnk:datePayment>${r[Receipts.date]}</bnk:datePayment>""")
        sb.appendLine("""        <bnk:dateStatement>${r[Receipts.date]}</bnk:dateStatement>""")
        sb.appendLine("""        <bnk:text>${text.xml()}</bnk:text>""")
        appendReceiptPartner(sb, r, "bnk")
        // <bnk:account> — v bank.xsd typ:refType (jen <typ:ids> = Pohoda Zkratka).
        // KLÍČOVÉ: bez něj Pohoda dokument přeřazuje do Pokladny.
        pohodaIds?.let { ids ->
            sb.appendLine("""        <bnk:account>""")
            sb.appendLine("""          <typ:ids>${ids.xml()}</typ:ids>""")
            sb.appendLine("""        </bnk:account>""")
        }
        sb.appendLine("""      </bnk:bankHeader>""")

        // ── bankDetail ──────────────────────────────────────────────────
        // V PU bere unitPrice = celkovou částku řádku (mobile pattern).
        val total = if (r[Receipts.totalWithVat].signum() > 0) r[Receipts.totalWithVat]
                    else items.fold(BigDecimal.ZERO) { acc, it -> acc.add(it[ReceiptItems.totalPrice]) }
        val desc = r[Receipts.merchantName].orEmpty().ifBlank { "Nakup" }.take(90)
        sb.appendLine("""      <bnk:bankDetail>""")
        sb.appendLine("""        <bnk:bankItem>""")
        sb.appendLine("""          <bnk:text>${desc.xml()}</bnk:text>""")
        sb.appendLine("""          <bnk:homeCurrency>""")
        sb.appendLine("""            <bnk:unitPrice>${total.fmt(2)}</bnk:unitPrice>""")
        sb.appendLine("""          </bnk:homeCurrency>""")
        sb.appendLine("""        </bnk:bankItem>""")
        sb.appendLine("""      </bnk:bankDetail>""")

        // ── bankSummary ─────────────────────────────────────────────────
        // bank.xsd povoluje jen "none" (banka se nezaokrouhluje).
        val totals = computeReceiptTotals(r[Receipts.totalWithVat], items, isVatPayer)
        sb.appendLine("""      <bnk:bankSummary>""")
        sb.appendLine("""        <bnk:roundingDocument>none</bnk:roundingDocument>""")
        sb.appendLine("""        <bnk:homeCurrency>""")
        appendTotalsLines(sb, totals, "bnk")
        sb.appendLine("""        </bnk:homeCurrency>""")
        sb.appendLine("""      </bnk:bankSummary>""")

        sb.appendLine("""    </bnk:bank>""")
        sb.appendLine("""  </dat:dataPackItem>""")
    }

    private fun appendReceiptPartner(sb: StringBuilder, r: ResultRow, ns: String) {
        val name = r[Receipts.merchantName].orEmpty()
        val ico = r[Receipts.merchantIco].orEmpty()
        // Vynech celý partner block jen pokud máme prázdné jméno I prázdné IČO (pak nemá smysl).
        if (name.isBlank() && ico.isBlank()) return
        sb.appendLine("""        <$ns:partnerIdentity>""")
        sb.appendLine("""          <typ:address>""")
        if (name.isNotBlank())
            sb.appendLine("""            <typ:company>${name.xml()}</typ:company>""")
        if (ico.isNotBlank())
            sb.appendLine("""            <typ:ico>${ico.xml()}</typ:ico>""")
        r[Receipts.merchantDic]?.takeIf { it.isNotBlank() }?.let {
            sb.appendLine("""            <typ:dic>${it.xml()}</typ:dic>""")
        }
        r[Receipts.merchantStreet]?.takeIf { it.isNotBlank() }?.let {
            sb.appendLine("""            <typ:street>${it.xml()}</typ:street>""")
        }
        r[Receipts.merchantCity]?.takeIf { it.isNotBlank() }?.let {
            sb.appendLine("""            <typ:city>${it.xml()}</typ:city>""")
        }
        r[Receipts.merchantZip]?.takeIf { it.isNotBlank() }?.let {
            sb.appendLine("""            <typ:zip>${it.xml()}</typ:zip>""")
        }
        sb.appendLine("""            <typ:country><typ:ids>CZ</typ:ids></typ:country>""")
        sb.appendLine("""          </typ:address>""")
        sb.appendLine("""        </$ns:partnerIdentity>""")
    }

    // ═══════════════════════════════════════════════════════════════════
    // INVOICES
    // ═══════════════════════════════════════════════════════════════════

    suspend fun exportInvoices(
        profileDbId: UUID,
        from: LocalDate? = null,
        to: LocalDate? = null,
        ids: List<UUID>? = null,
        isVatPayer: Boolean = false,
    ): String = db {
        val profile = Profiles.selectAll().where { Profiles.id eq EntityID(profileDbId, Profiles) }
            .singleOrNull()
        val userIco = profile?.get(Profiles.ico).orEmpty()

        val baseQuery = Invoices.selectAll()
            .where { (Invoices.profileId eq EntityID(profileDbId, Profiles)) and (Invoices.deletedAt eq null) }
            .orderBy(Invoices.issueDate)
            .toList()

        val rows = if (!ids.isNullOrEmpty()) {
            val idSet = ids.toSet()
            baseQuery.filter { it[Invoices.syncId] in idSet }
        } else {
            baseQuery.filter {
                val d = it[Invoices.issueDate] ?: return@filter from == null && to == null
                (from == null || !d.isBefore(from)) && (to == null || !d.isAfter(to))
            }
        }

        if (rows.isEmpty()) "" else buildString {
            appendLine("""<?xml version="1.0" encoding="UTF-8"?>""")
            appendLine(
                """<dat:dataPack""" +
                    """ xmlns:dat="http://www.stormware.cz/schema/version_2/data.xsd"""" +
                    """ xmlns:inv="http://www.stormware.cz/schema/version_2/invoice.xsd"""" +
                    """ xmlns:typ="http://www.stormware.cz/schema/version_2/type.xsd"""" +
                    """ version="2.0"""" +
                    """ id="Cointrack_${LocalDate.now()}"""" +
                    """ application="Cointrack"""" +
                    """ ico="${userIco.xml()}"""" +
                    """ note="Export faktur - Cointrack">"""
            )
            rows.forEachIndexed { idx, r ->
                val items = InvoiceItems.selectAll()
                    .where { InvoiceItems.invoiceId eq r[Invoices.id] }
                    .orderBy(InvoiceItems.position)
                    .toList()
                appendInvoice(this, r, items, idx + 1, isVatPayer)
            }
            appendLine("</dat:dataPack>")
        }
    }

    private fun appendInvoice(sb: StringBuilder, r: ResultRow, items: List<ResultRow>, seq: Int, isVatPayer: Boolean) {
        val isExpense = r[Invoices.isExpense]
        val invoiceType = if (isExpense) "receivedInvoice" else "issuedInvoice"
        val partnerName = if (isExpense) r[Invoices.supplierName].orEmpty()
                          else r[Invoices.customerName].orEmpty()
        val baseText = r[Invoices.note]?.takeIf { it.isNotBlank() }
            ?: partnerName.ifBlank { if (isExpense) "Nakup" else "Prodej" }
        // URL na detail v Cointrack pokud je nahraný soubor.
        val fileNote = invoiceFileUrl(r)
        val text = (if (fileNote != null) "$baseText | Soubor: $fileNote" else baseText).take(240)

        sb.appendLine("""  <dat:dataPackItem id="$seq" version="2.0">""")
        sb.appendLine("""    <inv:invoice version="2.0">""")
        sb.appendLine("""      <inv:invoiceHeader>""")
        sb.appendLine("""        <inv:invoiceType>$invoiceType</inv:invoiceType>""")

        val invoiceNumber = r[Invoices.invoiceNumber].orEmpty()
        if (invoiceNumber.isNotBlank()) {
            if (isExpense) {
                // Přijatá: originalDocument = číslo faktury od dodavatele (pole "Doklad" v Pohodě)
                sb.appendLine("""        <inv:originalDocument>${invoiceNumber.take(32).xml()}</inv:originalDocument>""")
            }
            // Variabilní symbol — buď explicit ze sync, nebo digits z čísla faktury
            val vs = r[Invoices.variableSymbol]?.takeIf { it.isNotBlank() }
                ?: invoiceNumber.filter { it.isDigit() }.takeLast(10)
            if (vs.isNotBlank()) {
                sb.appendLine("""        <inv:symVar>${vs.xml()}</inv:symVar>""")
            }
        }

        r[Invoices.issueDate]?.let { sb.appendLine("""        <inv:date>$it</inv:date>""") }
        r[Invoices.issueDate]?.let { sb.appendLine("""        <inv:dateTax>$it</inv:dateTax>""") }
        r[Invoices.dueDate]?.let { sb.appendLine("""        <inv:dateDue>$it</inv:dateDue>""") }

        // Členění DPH — pro přijatou fakturu "PN" (Přijaté plnění), u neplátce "nonSubsume".
        if (isExpense) {
            sb.appendLine("""        <inv:classificationVAT>""")
            if (!isVatPayer) {
                sb.appendLine("""          <typ:classificationVATType>nonSubsume</typ:classificationVATType>""")
            } else {
                sb.appendLine("""          <typ:ids>PN</typ:ids>""")
            }
            sb.appendLine("""        </inv:classificationVAT>""")
        }

        sb.appendLine("""        <inv:text>${text.xml()}</inv:text>""")

        // Partner identity (s IČO + DIČ + adresou).
        sb.appendLine("""        <inv:partnerIdentity>""")
        sb.appendLine("""          <typ:address>""")
        if (partnerName.isNotBlank()) sb.appendLine("""            <typ:company>${partnerName.xml()}</typ:company>""")
        r[Invoices.supplierIco]?.takeIf { it.isNotBlank() }?.let {
            sb.appendLine("""            <typ:ico>${it.xml()}</typ:ico>""")
        }
        r[Invoices.supplierDic]?.takeIf { it.isNotBlank() }?.let {
            sb.appendLine("""            <typ:dic>${it.xml()}</typ:dic>""")
        }
        r[Invoices.supplierStreet]?.takeIf { it.isNotBlank() }?.let {
            sb.appendLine("""            <typ:street>${it.xml()}</typ:street>""")
        }
        r[Invoices.supplierCity]?.takeIf { it.isNotBlank() }?.let {
            sb.appendLine("""            <typ:city>${it.xml()}</typ:city>""")
        }
        r[Invoices.supplierZip]?.takeIf { it.isNotBlank() }?.let {
            sb.appendLine("""            <typ:zip>${it.xml()}</typ:zip>""")
        }
        sb.appendLine("""            <typ:country><typ:ids>CZ</typ:ids></typ:country>""")
        sb.appendLine("""          </typ:address>""")
        sb.appendLine("""        </inv:partnerIdentity>""")

        // paymentType — enum lowercase
        val pmEnum = when (r[Invoices.paymentMethod]) {
            "CASH" -> "cash"
            "CARD" -> "creditcard"
            else -> "draft"  // bankovní převod (default pro fakturu)
        }
        sb.appendLine("""        <inv:paymentType>""")
        sb.appendLine("""          <typ:paymentType>$pmEnum</typ:paymentType>""")
        sb.appendLine("""        </inv:paymentType>""")

        sb.appendLine("""      </inv:invoiceHeader>""")

        // ── invoiceDetail ───────────────────────────────────────────────
        sb.appendLine("""      <inv:invoiceDetail>""")
        if (items.isEmpty()) {
            // Faktura bez položek — vytvoř 1 syntetickou položku za celkovou částku
            val total = r[Invoices.totalWithVat]
            if (total.signum() > 0) {
                val desc = partnerName.ifBlank { "Faktura" }.take(90)
                sb.appendLine("""        <inv:invoiceItem>""")
                sb.appendLine("""          <inv:text>${desc.xml()}</inv:text>""")
                sb.appendLine("""          <inv:quantity>1.0000</inv:quantity>""")
                sb.appendLine("""          <inv:coefficient>1.0</inv:coefficient>""")
                sb.appendLine("""          <inv:payVAT>false</inv:payVAT>""")
                sb.appendLine("""          <inv:rateVAT>none</inv:rateVAT>""")
                sb.appendLine("""          <inv:homeCurrency>""")
                sb.appendLine("""            <typ:unitPrice>${total.fmt(2)}</typ:unitPrice>""")
                sb.appendLine("""          </inv:homeCurrency>""")
                sb.appendLine("""        </inv:invoiceItem>""")
            }
        } else {
            items.forEach { item ->
                val name = item[InvoiceItems.name].take(90)
                val qty = item[InvoiceItems.quantity]
                val totalWithVat = item[InvoiceItems.totalPriceWithVat]
                // Mobile sync poslal pod jménem `unitPriceWithVat` ale obsahuje unitPriceWithoutVat
                // (legacy naming bug — ale konzistentní). Takže field je unitWithoutVat.
                val storedUnitWithoutVat = item[InvoiceItems.unitPriceWithVat]
                val vatRate = item[InvoiceItems.vatRate] ?: BigDecimal.ZERO

                val (rateKey, unitPrice, priceVat) = if (!isVatPayer || vatRate.signum() == 0) {
                    val unit = if (qty.signum() > 0) totalWithVat.divide(qty, 4, RoundingMode.HALF_UP) else totalWithVat
                    Triple("none", unit, BigDecimal.ZERO)
                } else {
                    val rate = invoiceVatRateToPohoda(vatRate.toInt())
                    val unit = storedUnitWithoutVat?.takeIf { it.signum() != 0 }
                        ?: run {
                            val withoutVat = totalWithVat.divide(BigDecimal.ONE.add(vatRate.divide(BigDecimal(100))), 4, RoundingMode.HALF_UP)
                            if (qty.signum() > 0) withoutVat.divide(qty, 4, RoundingMode.HALF_UP) else withoutVat
                        }
                    val vat = totalWithVat.subtract(unit.multiply(qty))
                    Triple(rate, unit, vat.coerceAtLeast(BigDecimal.ZERO))
                }
                sb.appendLine("""        <inv:invoiceItem>""")
                sb.appendLine("""          <inv:text>${name.xml()}</inv:text>""")
                sb.appendLine("""          <inv:quantity>${qty.fmt(4)}</inv:quantity>""")
                sb.appendLine("""          <inv:coefficient>1.0</inv:coefficient>""")
                sb.appendLine("""          <inv:payVAT>false</inv:payVAT>""")
                sb.appendLine("""          <inv:rateVAT>$rateKey</inv:rateVAT>""")
                sb.appendLine("""          <inv:homeCurrency>""")
                sb.appendLine("""            <typ:unitPrice>${unitPrice.fmt(2)}</typ:unitPrice>""")
                if (priceVat.signum() > 0) {
                    sb.appendLine("""            <typ:priceVAT>${priceVat.fmt(2)}</typ:priceVAT>""")
                }
                sb.appendLine("""          </inv:homeCurrency>""")
                sb.appendLine("""        </inv:invoiceItem>""")
            }
        }
        sb.appendLine("""      </inv:invoiceDetail>""")

        // ── invoiceSummary ──────────────────────────────────────────────
        val totals = computeInvoiceTotals(r[Invoices.totalWithVat], items, isVatPayer)
        sb.appendLine("""      <inv:invoiceSummary>""")
        sb.appendLine("""        <inv:roundingDocument>math2one</inv:roundingDocument>""")
        sb.appendLine("""        <inv:homeCurrency>""")
        appendTotalsLines(sb, totals, "inv")
        sb.appendLine("""        </inv:homeCurrency>""")
        sb.appendLine("""      </inv:invoiceSummary>""")
        sb.appendLine("""    </inv:invoice>""")
        sb.appendLine("""  </dat:dataPackItem>""")
    }

    // ═══════════════════════════════════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Pokud má účtenka aspoň jednu fotku (photoKeys JSON není "[]") A je
     * nakonfigurováno PUBLIC_WEB_URL, vrátí URL odkazu na detail účtenky.
     */
    private fun receiptPhotoUrl(r: ResultRow): String? {
        val webUrl = publicWebUrl ?: return null
        val photoKeys = r[Receipts.photoKeys]
        if (photoKeys.isBlank() || photoKeys == "[]") return null
        return "$webUrl/app/receipts/${r[Receipts.syncId]}"
    }

    private fun invoiceFileUrl(r: ResultRow): String? {
        val webUrl = publicWebUrl ?: return null
        val fileKeys = r[Invoices.fileKeys]
        if (fileKeys.isBlank() || fileKeys == "[]") return null
        return "$webUrl/app/invoices/${r[Invoices.syncId]}"
    }

    // ── DPH sazby ──────────────────────────────────────────────────────
    //
    // RECEIPTS — mobile používá explicit mapping (vatRateToPohoda v ReceiptOcrParser):
    //   0% → none, 10% → third, 12% → low, 15% → low, 21% → high
    // INVOICES — mobile používá rozsah:
    //   0 → none, 10..15 → low, else → high

    private fun vatRateToPohoda(rate: Int): String = when (rate) {
        0    -> "none"
        10   -> "third"
        12   -> "low"
        15   -> "low"
        21   -> "high"
        else -> "high"
    }

    private fun invoiceVatRateToPohoda(rate: Int): String = when {
        rate <= 0 -> "none"
        rate in 10..15 -> "low"
        else -> "high"
    }

    // ── Totals (priceNone / priceLow / priceHigh) ──────────────────────

    private data class Totals(
        val priceNone: BigDecimal,
        val priceLow: BigDecimal,
        val priceLowVat: BigDecimal,
        val priceHigh: BigDecimal,
        val priceHighVat: BigDecimal,
    )

    /**
     * Spočítá totals pro účtenku podle mobile patternu:
     *   - Neplátce / vatRate=0: priceNone += totalWithVat (celá částka jako základ)
     *   - Plátce: base = unitWithoutVat * qty (nebo derived z total/(1+rate))
     *             priceLow/High += base, priceLowVat/HighVat += vat
     *   - Sazby: <=15% → low, >15% → high (sjednoceno s mobile invoice mapping)
     */
    private fun computeReceiptTotals(grandTotal: BigDecimal, items: List<ResultRow>, isVatPayer: Boolean): Totals {
        var none = BigDecimal.ZERO
        var low = BigDecimal.ZERO
        var lowVat = BigDecimal.ZERO
        var high = BigDecimal.ZERO
        var highVat = BigDecimal.ZERO

        items.forEach { item ->
            val totalWithVat = item[ReceiptItems.totalPrice]
            val storedUnit = item[ReceiptItems.unitPrice]
            val qty = item[ReceiptItems.quantity]
            val vatRate = item[ReceiptItems.vatRate] ?: BigDecimal.ZERO

            if (!isVatPayer || vatRate.signum() == 0) {
                // Neplátce: celá cena s DPH do priceNone (mobile pattern).
                none = none.add(totalWithVat)
            } else {
                val base = storedUnit?.takeIf { it.signum() != 0 }?.multiply(qty)
                    ?: totalWithVat.divide(BigDecimal.ONE.add(vatRate.divide(BigDecimal(100))), 4, RoundingMode.HALF_UP)
                val vatAmount = totalWithVat.subtract(base).coerceAtLeast(BigDecimal.ZERO)
                if (vatRate.toInt() <= 15) {
                    low = low.add(base); lowVat = lowVat.add(vatAmount)
                } else {
                    high = high.add(base); highVat = highVat.add(vatAmount)
                }
            }
        }
        // Fallback: pokud položky nebyly nebo vše 0, použij grandTotal jako priceNone.
        if (none.signum() == 0 && low.signum() == 0 && high.signum() == 0 && grandTotal.signum() > 0) {
            none = grandTotal
        }
        return Totals(none, low, lowVat, high, highVat)
    }

    /**
     * Spočítá totals pro fakturu (mobile pattern z InvoiceXmlExporter).
     * Stejná logika jako u účtenek, ale items pochází z InvoiceItems.
     */
    private fun computeInvoiceTotals(grandTotal: BigDecimal, items: List<ResultRow>, isVatPayer: Boolean): Totals {
        var none = BigDecimal.ZERO
        var low = BigDecimal.ZERO
        var lowVat = BigDecimal.ZERO
        var high = BigDecimal.ZERO
        var highVat = BigDecimal.ZERO

        if (items.isEmpty()) {
            none = grandTotal
        } else {
            items.forEach { item ->
                val totalWithVat = item[InvoiceItems.totalPriceWithVat]
                val storedUnit = item[InvoiceItems.unitPriceWithVat]   // sync naming bug, je to without VAT
                val qty = item[InvoiceItems.quantity]
                val vatRate = item[InvoiceItems.vatRate] ?: BigDecimal.ZERO

                if (!isVatPayer || vatRate.signum() == 0) {
                    none = none.add(totalWithVat)
                } else {
                    val base = storedUnit?.takeIf { it.signum() != 0 }?.multiply(qty)
                        ?: totalWithVat.divide(BigDecimal.ONE.add(vatRate.divide(BigDecimal(100))), 4, RoundingMode.HALF_UP)
                    val vatAmount = totalWithVat.subtract(base).coerceAtLeast(BigDecimal.ZERO)
                    if (vatRate.toInt() <= 15) {
                        low = low.add(base); lowVat = lowVat.add(vatAmount)
                    } else {
                        high = high.add(base); highVat = highVat.add(vatAmount)
                    }
                }
            }
        }
        if (none.signum() == 0 && low.signum() == 0 && high.signum() == 0 && grandTotal.signum() > 0) {
            none = grandTotal
        }
        return Totals(none, low, lowVat, high, highVat)
    }

    private fun appendTotalsLines(sb: StringBuilder, t: Totals, ns: String) {
        if (t.priceNone.signum() > 0) {
            sb.appendLine("""          <typ:priceNone>${t.priceNone.fmt(2)}</typ:priceNone>""")
        }
        if (t.priceLow.signum() > 0) {
            sb.appendLine("""          <typ:priceLow>${t.priceLow.fmt(2)}</typ:priceLow>""")
            sb.appendLine("""          <typ:priceLowVAT>${t.priceLowVat.fmt(2)}</typ:priceLowVAT>""")
        }
        if (t.priceHigh.signum() > 0) {
            sb.appendLine("""          <typ:priceHigh>${t.priceHigh.fmt(2)}</typ:priceHigh>""")
            sb.appendLine("""          <typ:priceHighVAT>${t.priceHighVat.fmt(2)}</typ:priceHighVAT>""")
        }
    }

    // ── Bank account / Pohoda Zkratka ──────────────────────────────────

    /**
     * V29: fallback pro CARD účtenky bez explicit linked account — najde první
     * BANK-typ účet v profilu. Vrátí jeho Pohoda Zkratku.
     */
    private fun defaultBankAccountIds(profileDbId: java.util.UUID): String? {
        val firstBank = Accounts.selectAll()
            .where {
                (Accounts.profileId eq EntityID(profileDbId, Profiles)) and
                    (Accounts.type eq "BANK") and
                    (Accounts.deletedAt.isNull())
            }
            .orderBy(Accounts.createdAt)
            .limit(1)
            .singleOrNull() ?: return null
        return pohodaIdsForAccount(firstBank[Accounts.id].value)
    }

    /**
     * Pohoda "Zkratka" (typ:ids, max 19 znaků). Preferuje explicit
     * [Accounts.pohodaShortcut]; jinak fallback na sanitovaný [Accounts.name].
     */
    private fun pohodaIdsForAccount(accountDbId: java.util.UUID): String? {
        val acc = Accounts.selectAll()
            .where { Accounts.id eq accountDbId }
            .singleOrNull() ?: return null
        acc[Accounts.pohodaShortcut]?.trim()?.takeIf { it.isNotBlank() }
            ?.take(19)?.let { return it }
        val raw = java.text.Normalizer.normalize(acc[Accounts.name], java.text.Normalizer.Form.NFD)
            .replace("\\p{InCombiningDiacriticalMarks}+".toRegex(), "")
            .uppercase()
            .replace("[^A-Z0-9]".toRegex(), "")
            .take(19)
        return raw.takeIf { it.isNotBlank() }
    }

    // ── Formatting & escaping ──────────────────────────────────────────

    private fun BigDecimal.fmt(decimals: Int): String =
        "%.${decimals}f".format(Locale.US, this.setScale(decimals, RoundingMode.HALF_UP))

    /**
     * Escape pro XML text content + filtr znaků zakázaných XML 1.0
     * (control 0x00–0x1F kromě \t \n \r). Bez toho Pohoda hlásí
     * "An invalid character was found in text content".
     */
    private fun String.xml(): String = buildString(this.length) {
        for (c in this@xml) {
            val code = c.code
            val valid = code == 0x9 || code == 0xA || code == 0xD ||
                code in 0x20..0xD7FF || code in 0xE000..0xFFFD
            if (!valid) continue
            when (c) {
                '&' -> append("&amp;")
                '<' -> append("&lt;")
                '>' -> append("&gt;")
                '"' -> append("&quot;")
                '\'' -> append("&apos;")
                else -> append(c)
            }
        }
    }
}
