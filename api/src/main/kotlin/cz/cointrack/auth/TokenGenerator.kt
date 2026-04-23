package cz.cointrack.auth

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * Generátor náhodných tokenů (refresh tokens, email verify, password reset).
 *
 * Vracíme plaintextový token klientovi, ukládáme jen SHA-256 hash v DB.
 * Pokud se DB unikne, tokeny nejsou použitelné.
 */
object TokenGenerator {
    private val random = SecureRandom()
    private val encoder = Base64.getUrlEncoder().withoutPadding()
    private val digest = MessageDigest.getInstance("SHA-256")

    /** 32 bytes → 43 ASCII znaků v base64url. Ekvivalent 256 bitů entropie. */
    fun newToken(): String {
        val bytes = ByteArray(32)
        random.nextBytes(bytes)
        return encoder.encodeToString(bytes)
    }

    fun hash(token: String): String {
        val hashed = synchronized(digest) {
            digest.reset()
            digest.digest(token.toByteArray(Charsets.UTF_8))
        }
        return encoder.encodeToString(hashed)
    }
}
