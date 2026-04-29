package cz.cointrack.payments

import cz.cointrack.db.Payments
import cz.cointrack.db.Users
import cz.cointrack.db.db
import cz.cointrack.email.EmailTemplates
import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.dao.id.EntityID
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.insertAndGetId
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import org.slf4j.LoggerFactory
import java.math.BigDecimal
import java.security.SecureRandom
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

class PaymentService(
    private val config: PaymentConfig,
    private val email: cz.cointrack.email.EmailService? = null,
    private val supplier: SupplierConfig = SupplierConfig.default(),
) {
    private val log = LoggerFactory.getLogger(PaymentService::class.java)
    private val rng = SecureRandom()

    data class SupplierConfig(
        val name: String,
        val address: String,
        val ico: String,
        val dic: String?,
        val bankAccount: String,
    ) {
        companion object {
            fun default() = SupplierConfig(
                name = System.getenv("SUPPLIER_NAME") ?: "Cointrack",
                address = System.getenv("SUPPLIER_ADDRESS") ?: "—",
                ico = System.getenv("SUPPLIER_ICO") ?: "—",
                dic = System.getenv("SUPPLIER_DIC")?.takeIf { it.isNotBlank() },
                bankAccount = System.getenv("PAYMENT_BANK_ACCOUNT") ?: "—",
            )
        }
    }

    @Serializable
    data class PaymentConfig(
        /** IBAN firemního účtu, kam mají chodit platby. */
        val iban: String,
        /** Display formát "číslo/kód" pro UI. */
        val bankAccountDisplay: String,
        /** Délka platnosti QR (dní). Default 7. */
        val expirationDays: Int = 7,
    )

    @Serializable
    data class StartRequest(
        val tier: String,                       // PERSONAL/BUSINESS/ORGANIZATION
        val period: String,                     // MONTHLY/YEARLY
        val companyName: String? = null,
        val companyIco: String? = null,
        val companyDic: String? = null,
        val companyAddress: String? = null,
    )

    @Serializable
    data class StartResponse(
        val paymentId: String,
        val amount: String,
        val currency: String,
        val variableSymbol: String,
        val iban: String,
        val bankAccount: String,
        val spayd: String,           // QR data
        val expiresAt: String,
    )

    @Serializable
    data class StatusResponse(
        val paymentId: String,
        val status: String,
        val tier: String,
        val period: String,
        val amount: String,
        val variableSymbol: String,
        val createdAt: String,
        val paidAt: String? = null,
        val expiresAt: String,
    )

    /** Vytvoří PENDING platbu, vrátí QR data. */
    suspend fun startPayment(userId: UUID, req: StartRequest): StartResponse {
        // Normalizujeme legacy 'ORGANIZATION' z old klientů na nové 'BUSINESS_PRO'.
        val tier = req.tier.uppercase().let {
            if (it == "ORGANIZATION") "BUSINESS_PRO" else it
        }
        if (tier !in setOf("PERSONAL", "BUSINESS", "BUSINESS_PRO")) {
            throw ApiException(HttpStatusCode.BadRequest, "invalid_tier",
                "Neplatný tier — musí být PERSONAL, BUSINESS nebo BUSINESS_PRO.")
        }
        val period = runCatching { Pricing.Period.valueOf(req.period.uppercase()) }
            .getOrElse { throw ApiException(HttpStatusCode.BadRequest, "invalid_period",
                "Neplatná perioda — musí být MONTHLY nebo YEARLY.") }
        val amount = Pricing.amount(tier, period)
            ?: throw ApiException(HttpStatusCode.BadRequest, "no_price",
                "Pro $tier $period není definovaná cena.")

        val now = Instant.now()
        val expiresAt = now.plus(config.expirationDays.toLong(), ChronoUnit.DAYS)
        val vs = generateVariableSymbol()
        val email = db {
            Users.selectAll().where { Users.id eq userId }.singleOrNull()?.get(Users.email)
        }

        val paymentId = db {
            Payments.insertAndGetId {
                it[Payments.userId] = EntityID(userId, Users)
                it[Payments.tier] = tier
                it[Payments.period] = period.name
                it[Payments.amount] = amount
                it[Payments.currency] = "CZK"
                it[Payments.variableSymbol] = vs
                it[Payments.iban] = config.iban
                it[Payments.bankAccount] = config.bankAccountDisplay
                it[Payments.status] = "PENDING"
                it[Payments.companyName] = req.companyName
                it[Payments.companyIco] = req.companyIco
                it[Payments.companyDic] = req.companyDic
                it[Payments.companyAddress] = req.companyAddress
                it[Payments.customerEmail] = email
                it[Payments.createdAt] = now
                it[Payments.expiresAt] = expiresAt
            }.value
        }

        val spayd = Spayd.build(
            iban = config.iban,
            amount = amount,
            variableSymbol = vs,
            message = "Cointrack $tier",
        )

        return StartResponse(
            paymentId = paymentId.toString(),
            amount = amount.toPlainString(),
            currency = "CZK",
            variableSymbol = vs,
            iban = config.iban,
            bankAccount = config.bankAccountDisplay,
            spayd = spayd,
            expiresAt = expiresAt.toString(),
        )
    }

    /** Status platby — pro polling z webu. */
    suspend fun status(userId: UUID, paymentId: UUID): StatusResponse = db {
        val row = Payments.selectAll().where { Payments.id eq paymentId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "not_found", "Platba nenalezena.")
        if (row[Payments.userId].value != userId) {
            throw ApiException(HttpStatusCode.Forbidden, "not_owner", "Platba nepatří přihlášenému uživateli.")
        }
        StatusResponse(
            paymentId = row[Payments.id].value.toString(),
            status = row[Payments.status],
            tier = row[Payments.tier],
            period = row[Payments.period],
            amount = row[Payments.amount].toPlainString(),
            variableSymbol = row[Payments.variableSymbol],
            createdAt = row[Payments.createdAt].toString(),
            paidAt = row[Payments.paidAt]?.toString(),
            expiresAt = row[Payments.expiresAt].toString(),
        )
    }

    /** Seznam mých plateb (poslední 50). */
    suspend fun listMine(userId: UUID): List<StatusResponse> = db {
        Payments.selectAll()
            .where { Payments.userId eq userId }
            .orderBy(Payments.createdAt, SortOrder.DESC)
            .limit(50)
            .map { row ->
                StatusResponse(
                    paymentId = row[Payments.id].value.toString(),
                    status = row[Payments.status],
                    tier = row[Payments.tier],
                    period = row[Payments.period],
                    amount = row[Payments.amount].toPlainString(),
                    variableSymbol = row[Payments.variableSymbol],
                    createdAt = row[Payments.createdAt].toString(),
                    paidAt = row[Payments.paidAt]?.toString(),
                    expiresAt = row[Payments.expiresAt].toString(),
                )
            }
    }

    /**
     * Manuální označení platby jako zaplacené (admin operation).
     * Upgrade tieru se aplikuje hned: tier_expires_at = max(now, current) + period.
     */
    suspend fun markPaid(paymentId: UUID, matchedTxId: String? = null) {
        var emailToSend: Triple<String, EmailTemplates.InvoiceData, String?>? = null
        db {
            val row = Payments.selectAll().where { Payments.id eq paymentId }.singleOrNull()
                ?: throw ApiException(HttpStatusCode.NotFound, "not_found", "Platba nenalezena.")
            if (row[Payments.status] == "PAID") return@db
            val userId = row[Payments.userId].value
            val tier = row[Payments.tier]
            val period = Pricing.Period.valueOf(row[Payments.period])
            val months = Pricing.monthsFor(period)

            val now = Instant.now()
            val currentExpires = Users.selectAll().where { Users.id eq userId }
                .singleOrNull()?.get(Users.tierExpiresAt)
            val baseExpires = if (currentExpires != null && currentExpires.isAfter(now)) currentExpires else now
            val newExpires = baseExpires.plus(months * 30L, ChronoUnit.DAYS)

            Users.update({ Users.id eq userId }) {
                it[Users.tier] = tier
                it[tierExpiresAt] = newExpires
                it[updatedAt] = now
            }

            // Generování invoice number — DB sequence
            val seq = org.jetbrains.exposed.sql.Database.connect("dummy")
                .let { _ -> }   // placeholder — actual nextval below
            val invoiceNum = nextInvoiceNumber(now)

            Payments.update({ Payments.id eq paymentId }) {
                it[status] = "PAID"
                it[paidAt] = now
                it[invoiceNumber] = invoiceNum
                if (matchedTxId != null) it[Payments.matchedTxId] = matchedTxId
            }

            // Sestav data pro email
            val customerEmail = row[Payments.customerEmail]
            if (customerEmail != null && email != null) {
                val data = EmailTemplates.InvoiceData(
                    invoiceNumber = invoiceNum,
                    issuedAt = java.time.LocalDate.now().toString(),
                    customerName = row[Payments.companyName] ?: customerEmail,
                    customerAddress = row[Payments.companyAddress] ?: "—",
                    customerIco = row[Payments.companyIco],
                    customerDic = row[Payments.companyDic],
                    tier = tier,
                    period = period.name,
                    amount = row[Payments.amount].toPlainString(),
                    currency = row[Payments.currency],
                    variableSymbol = row[Payments.variableSymbol],
                    supplierName = supplier.name,
                    supplierAddress = supplier.address,
                    supplierIco = supplier.ico,
                    supplierDic = supplier.dic,
                    supplierBankAccount = supplier.bankAccount,
                )
                val userLocale = Users.selectAll().where { Users.id eq userId }
                    .singleOrNull()?.get(Users.locale)
                emailToSend = Triple(customerEmail, data, userLocale)
            }
        }

        emailToSend?.let { (toEmail, data, locale) ->
            try {
                email!!.send(
                    to = toEmail,
                    subject = EmailTemplates.paymentInvoiceSubject(data.invoiceNumber, locale),
                    htmlBody = EmailTemplates.paymentInvoice(data, locale),
                )
                db {
                    Payments.update({ Payments.id eq paymentId }) {
                        it[emailSentAt] = Instant.now()
                    }
                }
            } catch (e: Exception) {
                log.warn("Nepodařilo se odeslat fakturu emailem: ${e.message}")
            }
        }

        log.info("Payment $paymentId marked as PAID (matchedTxId=$matchedTxId)")
    }

    /**
     * Vrací invoice number ve formátu `YYYY/000001` z DB sekvence
     * `payment_invoice_seq`. Volat **uvnitř** db {} bloku.
     */
    private fun nextInvoiceNumber(now: Instant): String {
        val year = now.atZone(java.time.ZoneId.systemDefault()).year
        val seq = org.jetbrains.exposed.sql.transactions.TransactionManager
            .current().exec("SELECT nextval('payment_invoice_seq')") { rs ->
                if (rs.next()) rs.getLong(1) else 0L
            } ?: 0L
        return "%d/%06d".format(year, seq)
    }

    /** Najde PENDING platbu s daným VS a přibližně sedící částkou. Pro Fio reconciliation worker. */
    suspend fun findPendingByVariableSymbol(vs: String, amount: BigDecimal): UUID? = db {
        val tolerance = BigDecimal("0.01")
        Payments.selectAll()
            .where {
                (Payments.variableSymbol eq vs) and
                    (Payments.status eq "PENDING")
            }
            .singleOrNull()
            ?.takeIf { (it[Payments.amount] - amount).abs() < tolerance }
            ?.get(Payments.id)?.value
    }

    /**
     * Variabilní symbol = ČNB-povolené 1-10 číslic.
     * Generujeme 9-cifernou náhodu (1×10⁹ kombinací).
     */
    private fun generateVariableSymbol(): String {
        // 100_000_000 - 999_999_999 (9 cifer)
        val n = 100_000_000L + (rng.nextLong().mod(900_000_000L))
        return n.toString()
    }
}

