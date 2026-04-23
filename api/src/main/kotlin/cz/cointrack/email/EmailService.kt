package cz.cointrack.email

import jakarta.mail.Authenticator
import jakarta.mail.Message
import jakarta.mail.PasswordAuthentication
import jakarta.mail.Session
import jakarta.mail.Transport
import jakarta.mail.internet.InternetAddress
import jakarta.mail.internet.MimeMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.slf4j.LoggerFactory
import java.util.Properties

data class EmailConfig(
    val host: String,
    val port: Int,
    val user: String,
    val password: String,
    val from: String,
)

open class EmailService(private val config: EmailConfig) {
    private val log = LoggerFactory.getLogger(EmailService::class.java)

    private val session: Session by lazy {
        val props = Properties().apply {
            put("mail.smtp.host", config.host)
            put("mail.smtp.port", config.port.toString())
            put("mail.smtp.auth", if (config.user.isNotBlank()) "true" else "false")
            put("mail.smtp.starttls.enable", if (config.port == 587) "true" else "false")
            put("mail.smtp.ssl.trust", config.host)  // pro self-signed dev certifikáty
        }
        if (config.user.isNotBlank()) {
            Session.getInstance(props, object : Authenticator() {
                override fun getPasswordAuthentication() =
                    PasswordAuthentication(config.user, config.password)
            })
        } else {
            Session.getInstance(props)
        }
    }

    open suspend fun send(to: String, subject: String, htmlBody: String) = withContext(Dispatchers.IO) {
        try {
            val message = MimeMessage(session).apply {
                setFrom(InternetAddress(config.from, "Cointrack"))
                setRecipients(Message.RecipientType.TO, InternetAddress.parse(to))
                this.subject = subject
                setContent(htmlBody, "text/html; charset=utf-8")
            }
            Transport.send(message)
            log.info("Email sent to {} ('{}')", to, subject)
        } catch (e: Exception) {
            log.error("Email send failed to {}: {}", to, e.message)
            throw e
        }
    }
}
