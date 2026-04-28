package cz.cointrack.payments

/**
 * Generuje SPAYD (Short Payment Descriptor) string pro QR-platby — formát:
 *   SPD*1.0*ACC:<IBAN>*AM:<amount>*CC:<currency>*X-VS:<varSymbol>*MSG:<message>
 *
 * Specifikace: https://qr-platba.cz/pro-vyvojare/
 *
 * Podporuje ho většina českých mobilních bank (Fio, Air Bank, ČSOB, KB,
 * Raiffeisen, MONETA, ČS, mBank, Wise…). User naskenuje QR mobilním
 * bankovnictvím a platba je předvyplněná.
 */
object Spayd {

    fun build(
        iban: String,
        amount: java.math.BigDecimal,
        currency: String = "CZK",
        variableSymbol: String,
        message: String? = null,
    ): String {
        val parts = mutableListOf<String>()
        parts += "SPD*1.0"
        parts += "ACC:${iban.replace(" ", "")}"
        parts += "AM:${amount.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString()}"
        parts += "CC:$currency"
        parts += "X-VS:$variableSymbol"
        message?.takeIf { it.isNotBlank() }?.let {
            // SPAYD escapuje * jako %2A, povolené ASCII znaky
            val sanitized = it.replace("*", " ")
                .replace("\n", " ")
                .take(60)
            parts += "MSG:$sanitized"
        }
        return parts.joinToString("*")
    }
}
