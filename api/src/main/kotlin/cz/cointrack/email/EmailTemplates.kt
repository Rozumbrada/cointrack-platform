package cz.cointrack.email

/**
 * Jednoduché inline HTML šablony s i18n přes `users.locale` (cs/en).
 * Default je `cs` — pokud uživatel nemá nastaveno, dostane češtinu.
 */
object EmailTemplates {

    /** Vrátí cs/en variantu podle locale. */
    private fun pick(locale: String?, cs: String, en: String): String =
        if (locale?.startsWith("en") == true) en else cs

    private fun layout(title: String, body: String, locale: String?) = """
        <!doctype html>
        <html lang="${pick(locale, "cs", "en")}">
        <head>
            <meta charset="utf-8">
            <title>$title</title>
        </head>
        <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f7;">
            <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;padding:32px;">
                <h1 style="color:#111;font-size:24px;margin:0 0 24px;">Cointrack</h1>
                $body
                <hr style="border:none;border-top:1px solid #eee;margin:32px 0;">
                <p style="color:#888;font-size:12px;margin:0;">
                    ${pick(
                        locale,
                        "Tento email ti posíláme, protože někdo (pravděpodobně ty) použil tvůj email při registraci. Pokud jsi to nebyl ty, ignoruj ho.",
                        "We're sending you this email because someone (most likely you) used your address to sign up. If it wasn't you, please ignore it.",
                    )}
                </p>
            </div>
        </body>
        </html>
    """.trimIndent()

    fun verifyEmail(verifyUrl: String, locale: String? = null) = layout(
        title = pick(locale, "Ověř svůj email", "Verify your email"),
        locale = locale,
        body = """
            <p>${pick(locale, "Vítej v Cointracku.", "Welcome to Cointrack.")}</p>
            <p>${pick(
                locale,
                "Prosím potvrď, že tento email patří tobě, kliknutím na tlačítko:",
                "Please confirm this email belongs to you by clicking the button:",
            )}</p>
            <p>
                <a href="$verifyUrl"
                   style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                   ${pick(locale, "Ověřit email", "Verify email")}
                </a>
            </p>
            <p style="color:#666;font-size:14px;">
                ${pick(locale, "Odkaz platí 24 hodin.", "Link is valid for 24 hours.")}
            </p>
            <p style="color:#666;font-size:12px;">
                ${pick(locale, "Nebo zkopíruj:", "Or copy:")}<br><code>$verifyUrl</code>
            </p>
        """,
    )

    fun verifyEmailSubject(locale: String? = null): String =
        pick(locale, "Ověř svůj email pro Cointrack", "Verify your email for Cointrack")

    fun organizationInvite(
        organizationName: String,
        inviterEmail: String,
        role: String,
        acceptUrl: String,
        locale: String? = null,
    ): String {
        val roleLabel = if (locale?.startsWith("en") == true) {
            when (role) {
                "owner" -> "owner"
                "admin" -> "administrator"
                else -> "member"
            }
        } else {
            when (role) {
                "owner" -> "vlastníka"
                "admin" -> "administrátora"
                else -> "člena"
            }
        }
        return layout(
            title = pick(
                locale,
                "Pozvánka do organizace $organizationName",
                "Invitation to $organizationName",
            ),
            locale = locale,
            body = """
                <p>${pick(
                    locale,
                    "Uživatel <strong>$inviterEmail</strong> tě pozval do organizace <strong>$organizationName</strong> v Cointracku s rolí $roleLabel.",
                    "User <strong>$inviterEmail</strong> invited you to organization <strong>$organizationName</strong> in Cointrack with role $roleLabel.",
                )}</p>
                <p>
                    <a href="$acceptUrl"
                       style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                       ${pick(locale, "Přijmout pozvánku", "Accept invitation")}
                    </a>
                </p>
                <p style="color:#666;font-size:14px;">
                    ${pick(locale, "Odkaz platí 14 dní.", "Link is valid for 14 days.")}
                </p>
                <p style="color:#666;font-size:12px;">
                    ${pick(
                        locale,
                        "Pokud ještě nemáš účet Cointrack, budeš si moct nejdřív vytvořit na tento e-mail.",
                        "If you don't have a Cointrack account yet, you'll be able to create one with this email.",
                    )}
                    <br>${pick(locale, "Nebo zkopíruj:", "Or copy:")}<br><code>$acceptUrl</code>
                </p>
            """,
        )
    }

    fun passwordReset(resetUrl: String, locale: String? = null) = layout(
        title = pick(locale, "Obnova hesla", "Password reset"),
        locale = locale,
        body = """
            <p>${pick(
                locale,
                "Obdrželi jsme žádost o obnovení hesla pro tvůj účet.",
                "We received a request to reset the password for your account.",
            )}</p>
            <p>
                <a href="$resetUrl"
                   style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                   ${pick(locale, "Nastavit nové heslo", "Set new password")}
                </a>
            </p>
            <p style="color:#666;font-size:14px;">
                ${pick(locale, "Odkaz platí 1 hodinu.", "Link is valid for 1 hour.")}
            </p>
            <p style="color:#666;font-size:12px;">
                ${pick(
                    locale,
                    "Pokud jsi o obnovu nežádal, ignoruj tento email — tvé heslo zůstává beze změny.",
                    "If you didn't request a reset, ignore this email — your password stays unchanged.",
                )}
            </p>
        """,
    )

    fun passwordResetSubject(locale: String? = null): String =
        pick(locale, "Obnova hesla Cointrack", "Cointrack password reset")

    /**
     * Faktura jako HTML email (pro neplátce DPH — bez VAT řádků).
     */
    data class InvoiceData(
        val invoiceNumber: String,
        val issuedAt: String,            // YYYY-MM-DD
        val customerName: String,
        val customerAddress: String,
        val customerIco: String?,
        val customerDic: String?,
        val tier: String,                // PERSONAL/BUSINESS/ORGANIZATION
        val period: String,              // MONTHLY/YEARLY
        val amount: String,              // "199.00"
        val currency: String,
        val variableSymbol: String,
        val supplierName: String,
        val supplierAddress: String,
        val supplierIco: String,
        val supplierDic: String?,
        val supplierBankAccount: String,
    )

    fun paymentInvoice(d: InvoiceData, locale: String? = null) = layout(
        title = pick(locale, "Faktura ${d.invoiceNumber}", "Invoice ${d.invoiceNumber}"),
        locale = locale,
        body = """
            <h2 style="color:#111;font-size:20px;margin:0 0 16px;">
                ${pick(locale, "Děkujeme za platbu", "Thank you for your payment")}
            </h2>
            <p>${pick(
                locale,
                "Předplatné <strong>Cointrack ${d.tier}</strong> (${if (d.period == "MONTHLY") "měsíčně" else "ročně"}) je aktivní. Faktura k platbě je v příloze tohoto emailu.",
                "Subscription <strong>Cointrack ${d.tier}</strong> (${if (d.period == "MONTHLY") "monthly" else "yearly"}) is active. Invoice is attached.",
            )}</p>

            <table style="width:100%;border-collapse:collapse;margin:24px 0;">
                <tr>
                    <td style="vertical-align:top;padding:12px;background:#f5f5f7;border-radius:8px 0 0 8px;width:50%;">
                        <div style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">
                            ${pick(locale, "Dodavatel", "Supplier")}
                        </div>
                        <div style="font-weight:600;">${d.supplierName}</div>
                        <div style="color:#444;font-size:13px;line-height:1.5;">
                            ${d.supplierAddress}<br>
                            ${pick(locale, "IČO", "Company ID")}: ${d.supplierIco}${if (d.supplierDic != null) "<br>${pick(locale, "DIČ", "VAT ID")}: ${d.supplierDic}" else "<br><span style='color:#888'>${pick(locale, "Neplátce DPH", "Not VAT registered")}</span>"}
                        </div>
                    </td>
                    <td style="vertical-align:top;padding:12px;background:#f5f5f7;border-radius:0 8px 8px 0;">
                        <div style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">
                            ${pick(locale, "Odběratel", "Customer")}
                        </div>
                        <div style="font-weight:600;">${d.customerName}</div>
                        <div style="color:#444;font-size:13px;line-height:1.5;">
                            ${d.customerAddress}
                            ${if (d.customerIco != null) "<br>${pick(locale, "IČO", "Company ID")}: ${d.customerIco}" else ""}
                            ${if (d.customerDic != null) "<br>${pick(locale, "DIČ", "VAT ID")}: ${d.customerDic}" else ""}
                        </div>
                    </td>
                </tr>
            </table>

            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:8px 0;color:#666;font-size:12px;">${pick(locale, "Číslo faktury", "Invoice number")}</td>
                    <td style="padding:8px 0;text-align:right;font-weight:600;">${d.invoiceNumber}</td>
                </tr>
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:8px 0;color:#666;font-size:12px;">${pick(locale, "Datum vystavení", "Issue date")}</td>
                    <td style="padding:8px 0;text-align:right;">${d.issuedAt}</td>
                </tr>
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:8px 0;color:#666;font-size:12px;">${pick(locale, "Variabilní symbol", "Variable symbol")}</td>
                    <td style="padding:8px 0;text-align:right;font-family:monospace;">${d.variableSymbol}</td>
                </tr>
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:8px 0;color:#666;font-size:12px;">${pick(locale, "Bankovní účet", "Bank account")}</td>
                    <td style="padding:8px 0;text-align:right;font-family:monospace;">${d.supplierBankAccount}</td>
                </tr>
            </table>

            <table style="width:100%;border-collapse:collapse;margin:24px 0;">
                <thead>
                    <tr style="background:#f5f5f7;">
                        <th style="padding:12px;text-align:left;color:#666;font-size:12px;">${pick(locale, "Položka", "Item")}</th>
                        <th style="padding:12px;text-align:right;color:#666;font-size:12px;">${pick(locale, "Cena", "Price")}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="border-bottom:1px solid #eee;">
                        <td style="padding:12px;">
                            ${pick(
                                locale,
                                "Cointrack ${d.tier} — ${if (d.period == "MONTHLY") "měsíční" else "roční"} předplatné",
                                "Cointrack ${d.tier} — ${if (d.period == "MONTHLY") "monthly" else "yearly"} subscription",
                            )}
                        </td>
                        <td style="padding:12px;text-align:right;font-weight:600;">${d.amount} ${d.currency}</td>
                    </tr>
                    <tr style="background:#f5f5f7;">
                        <td style="padding:12px;font-weight:700;">${pick(locale, "Celkem k úhradě", "Total to pay")}</td>
                        <td style="padding:12px;text-align:right;font-weight:700;font-size:18px;">${d.amount} ${d.currency}</td>
                    </tr>
                </tbody>
            </table>

            <p style="color:#22aa22;font-weight:600;margin:24px 0 0;">${pick(locale, "✓ Platba již přijata.", "✓ Payment received.")}</p>
            <p style="color:#666;font-size:13px;">
                ${pick(
                    locale,
                    "Pro správu předplatného navštiv <a href=\"https://cointrack.cz/app/upgrade\" style=\"color:#3b82f6;\">cointrack.cz/app/upgrade</a>.",
                    "Manage your subscription at <a href=\"https://cointrack.cz/app/upgrade\" style=\"color:#3b82f6;\">cointrack.cz/app/upgrade</a>.",
                )}
            </p>
        """,
    )

    fun paymentInvoiceSubject(invoiceNumber: String, locale: String? = null): String =
        pick(locale, "Cointrack — Faktura $invoiceNumber", "Cointrack — Invoice $invoiceNumber")

    /** Reminder email 7 dní před expirací předplatného. */
    fun tierExpiryReminder(
        tier: String,
        expiresAtDate: String,
        daysLeft: Int,
        renewUrl: String,
        locale: String? = null,
    ) = layout(
        title = pick(locale, "Předplatné brzy vyprší", "Subscription expiring soon"),
        locale = locale,
        body = """
            <h2 style="color:#111;font-size:20px;margin:0 0 16px;">
                ${pick(locale, "Tvé předplatné brzy vyprší", "Your subscription is about to expire")}
            </h2>
            <p>${pick(
                locale,
                "Tarif <strong>Cointrack $tier</strong> ti vyprší <strong>$expiresAtDate</strong> (za $daysLeft ${if (daysLeft == 1) "den" else "dny"}).",
                "Your <strong>Cointrack $tier</strong> subscription expires on <strong>$expiresAtDate</strong> (in $daysLeft ${if (daysLeft == 1) "day" else "days"}).",
            )}</p>
            <p>${pick(
                locale,
                "Po expiraci se automaticky přepneš zpět na tarif <strong>FREE</strong> a ztratíš přístup k pokročilým funkcím (cloud sync, OCR účtenek, organizační účty…). Tvá data zůstanou nedotčená.",
                "After expiration you'll automatically switch back to <strong>FREE</strong> and lose access to advanced features (cloud sync, receipt OCR, organization accounts…). Your data stays intact.",
            )}</p>
            <p style="margin:24px 0;">
                <a href="$renewUrl"
                   style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                   ${pick(locale, "Prodloužit předplatné", "Renew subscription")}
                </a>
            </p>
            <p style="color:#666;font-size:13px;">
                ${pick(
                    locale,
                    "Platba probíhá přes QR kód (SPAYD) — během minuty máš opět plný tarif.",
                    "Payment goes through a QR code (SPAYD) — your full tier is back within a minute.",
                )}
            </p>
        """,
    )

    fun tierExpiryReminderSubject(daysLeft: Int, locale: String? = null): String =
        if (locale?.startsWith("en") == true) {
            "Cointrack — subscription expires in $daysLeft ${if (daysLeft == 1) "day" else "days"}"
        } else {
            "Cointrack — předplatné vyprší za $daysLeft ${if (daysLeft == 1) "den" else "dny"}"
        }

    /** Email po automatickém downgrade na FREE. */
    fun tierDowngradedToFree(reactivateUrl: String, locale: String? = null) = layout(
        title = pick(locale, "Přepnuto na FREE", "Switched to FREE"),
        locale = locale,
        body = """
            <h2 style="color:#111;font-size:20px;margin:0 0 16px;">
                ${pick(locale, "Přepnuli jsme tě na tarif FREE", "We've switched you to the FREE tier")}
            </h2>
            <p>${pick(
                locale,
                "Tvé předplatné Cointrack vypršelo a automaticky jsme tě přepnuli zpět na tarif <strong>FREE</strong>. Tvá data zůstávají v pořádku, jen některé pokročilé funkce (cloud sync, OCR, organizační účty) jsou nyní omezené.",
                "Your Cointrack subscription expired and we automatically moved you back to the <strong>FREE</strong> tier. Your data remains intact, just some advanced features (cloud sync, OCR, organization accounts) are now limited.",
            )}</p>
            <p style="margin:24px 0;">
                <a href="$reactivateUrl"
                   style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                   ${pick(locale, "Aktivovat předplatné znovu", "Reactivate subscription")}
                </a>
            </p>
        """,
    )

    fun tierDowngradedSubject(locale: String? = null): String =
        pick(locale, "Cointrack — přepnuto na FREE", "Cointrack — switched to FREE")
}
