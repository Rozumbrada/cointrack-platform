package cz.cointrack.payments

import java.math.BigDecimal

/**
 * Ceník — must match marketing pricing page (web /pricing).
 * Aktualizuj zde + na webu současně.
 */
object Pricing {

    enum class Period { MONTHLY, YEARLY }

    data class Price(val tier: String, val period: Period, val amount: BigDecimal)

    private val table: Map<Pair<String, Period>, BigDecimal> = mapOf(
        ("PERSONAL"     to Period.MONTHLY) to BigDecimal("69"),
        ("PERSONAL"     to Period.YEARLY)  to BigDecimal("690"),
        ("BUSINESS"     to Period.MONTHLY) to BigDecimal("199"),
        ("BUSINESS"     to Period.YEARLY)  to BigDecimal("1990"),
        ("BUSINESS_PRO" to Period.MONTHLY) to BigDecimal("399"),
        ("BUSINESS_PRO" to Period.YEARLY)  to BigDecimal("3990"),
    )

    /** Lookup ceny — akceptuje i legacy 'ORGANIZATION' pro starší klienty. */
    fun amount(tier: String, period: Period): BigDecimal? {
        val normalized = tier.uppercase().let {
            if (it == "ORGANIZATION") "BUSINESS_PRO" else it
        }
        return table[normalized to period]
    }

    fun all(): List<Price> = table.entries.map { (k, v) -> Price(k.first, k.second, v) }

    /** Kolik měsíců přidá daná perioda. */
    fun monthsFor(period: Period): Long = when (period) {
        Period.MONTHLY -> 1L
        Period.YEARLY -> 12L
    }
}
