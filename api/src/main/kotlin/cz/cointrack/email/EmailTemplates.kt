package cz.cointrack.email

/**
 * Jednoduché inline HTML šablony. Pro produkci zvážit MJML → build-time kompilace.
 */
object EmailTemplates {

    private fun layout(title: String, body: String) = """
        <!doctype html>
        <html lang="cs">
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
                    Tento email ti posíláme, protože někdo (pravděpodobně ty) použil tvůj email
                    při registraci. Pokud jsi to nebyl ty, ignoruj ho.
                </p>
            </div>
        </body>
        </html>
    """.trimIndent()

    fun verifyEmail(verifyUrl: String) = layout(
        title = "Ověř svůj email",
        body = """
            <p>Vítej v Cointracku.</p>
            <p>Prosím potvrď, že tento email patří tobě, kliknutím na tlačítko:</p>
            <p>
                <a href="$verifyUrl"
                   style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                   Ověřit email
                </a>
            </p>
            <p style="color:#666;font-size:14px;">Odkaz platí 24 hodin.</p>
            <p style="color:#666;font-size:12px;">Nebo zkopíruj: <br><code>$verifyUrl</code></p>
        """
    )

    fun organizationInvite(
        organizationName: String,
        inviterEmail: String,
        role: String,
        acceptUrl: String,
    ): String {
        val roleCz = when (role) {
            "owner" -> "vlastníka"
            "admin" -> "administrátora"
            else -> "člena"
        }
        return layout(
            title = "Pozvánka do organizace $organizationName",
            body = """
                <p>Uživatel <strong>$inviterEmail</strong> tě pozval do organizace
                   <strong>$organizationName</strong> v Cointracku s rolí $roleCz.</p>
                <p>
                    <a href="$acceptUrl"
                       style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                       Přijmout pozvánku
                    </a>
                </p>
                <p style="color:#666;font-size:14px;">Odkaz platí 14 dní.</p>
                <p style="color:#666;font-size:12px;">
                    Pokud ještě nemáš účet Cointrack, budeš si moct nejdřív vytvořit na tento e-mail.
                    <br>Nebo zkopíruj:<br><code>$acceptUrl</code>
                </p>
            """,
        )
    }

    fun passwordReset(resetUrl: String) = layout(
        title = "Obnova hesla",
        body = """
            <p>Obdrželi jsme žádost o obnovení hesla pro tvůj účet.</p>
            <p>
                <a href="$resetUrl"
                   style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                   Nastavit nové heslo
                </a>
            </p>
            <p style="color:#666;font-size:14px;">Odkaz platí 1 hodinu.</p>
            <p style="color:#666;font-size:12px;">
                Pokud jsi o obnovu nežádal, ignoruj tento email — tvé heslo zůstává beze změny.
            </p>
        """
    )

    /**
     * Faktura jako HTML email (pro neplátce DPH — bez VAT řádků).
     *
     * Pokud Cointrack přejde na plátce DPH, šablonu rozšiř o sazbu a základ daně.
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

    fun paymentInvoice(d: InvoiceData) = layout(
        title = "Faktura ${d.invoiceNumber}",
        body = """
            <h2 style="color:#111;font-size:20px;margin:0 0 16px;">Děkujeme za platbu</h2>
            <p>Předplatné <strong>Cointrack ${d.tier}</strong>
                (${if (d.period == "MONTHLY") "měsíčně" else "ročně"}) je aktivní.
                Faktura k platbě je v příloze tohoto emailu.</p>

            <table style="width:100%;border-collapse:collapse;margin:24px 0;">
                <tr>
                    <td style="vertical-align:top;padding:12px;background:#f5f5f7;border-radius:8px 0 0 8px;width:50%;">
                        <div style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Dodavatel</div>
                        <div style="font-weight:600;">${d.supplierName}</div>
                        <div style="color:#444;font-size:13px;line-height:1.5;">
                            ${d.supplierAddress}<br>
                            IČO: ${d.supplierIco}${if (d.supplierDic != null) "<br>DIČ: ${d.supplierDic}" else "<br><span style='color:#888'>Neplátce DPH</span>"}
                        </div>
                    </td>
                    <td style="vertical-align:top;padding:12px;background:#f5f5f7;border-radius:0 8px 8px 0;">
                        <div style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Odběratel</div>
                        <div style="font-weight:600;">${d.customerName}</div>
                        <div style="color:#444;font-size:13px;line-height:1.5;">
                            ${d.customerAddress}
                            ${if (d.customerIco != null) "<br>IČO: ${d.customerIco}" else ""}
                            ${if (d.customerDic != null) "<br>DIČ: ${d.customerDic}" else ""}
                        </div>
                    </td>
                </tr>
            </table>

            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:8px 0;color:#666;font-size:12px;">Číslo faktury</td>
                    <td style="padding:8px 0;text-align:right;font-weight:600;">${d.invoiceNumber}</td>
                </tr>
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:8px 0;color:#666;font-size:12px;">Datum vystavení</td>
                    <td style="padding:8px 0;text-align:right;">${d.issuedAt}</td>
                </tr>
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:8px 0;color:#666;font-size:12px;">Variabilní symbol</td>
                    <td style="padding:8px 0;text-align:right;font-family:monospace;">${d.variableSymbol}</td>
                </tr>
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:8px 0;color:#666;font-size:12px;">Bankovní účet</td>
                    <td style="padding:8px 0;text-align:right;font-family:monospace;">${d.supplierBankAccount}</td>
                </tr>
            </table>

            <table style="width:100%;border-collapse:collapse;margin:24px 0;">
                <thead>
                    <tr style="background:#f5f5f7;">
                        <th style="padding:12px;text-align:left;color:#666;font-size:12px;">Položka</th>
                        <th style="padding:12px;text-align:right;color:#666;font-size:12px;">Cena</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="border-bottom:1px solid #eee;">
                        <td style="padding:12px;">
                            Cointrack ${d.tier} — ${if (d.period == "MONTHLY") "měsíční" else "roční"} předplatné
                        </td>
                        <td style="padding:12px;text-align:right;font-weight:600;">${d.amount} ${d.currency}</td>
                    </tr>
                    <tr style="background:#f5f5f7;">
                        <td style="padding:12px;font-weight:700;">Celkem k úhradě</td>
                        <td style="padding:12px;text-align:right;font-weight:700;font-size:18px;">${d.amount} ${d.currency}</td>
                    </tr>
                </tbody>
            </table>

            <p style="color:#22aa22;font-weight:600;margin:24px 0 0;">✓ Platba již přijata.</p>
            <p style="color:#666;font-size:13px;">
                Pro správu předplatného navštiv
                <a href="https://cointrack.cz/app/upgrade" style="color:#3b82f6;">cointrack.cz/app/upgrade</a>.
            </p>
        """,
    )
}
