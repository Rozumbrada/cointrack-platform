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
}
