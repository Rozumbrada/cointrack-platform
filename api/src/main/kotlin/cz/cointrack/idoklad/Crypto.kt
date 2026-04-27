package cz.cointrack.idoklad

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * AES-256-GCM šifrování pro citlivé credentials (iDoklad Client Secret atd.).
 *
 * Master key se čte z env `IDOKLAD_ENC_KEY` (base64-encoded 32 bajtů).
 * Pokud chybí, fallback na deterministicky odvozený key z JWT_SECRET — to není
 * ideální (sdílí klíč s JWT), ale prevence pádu při nedeklarované konfiguraci.
 *
 * Output formát: base64(nonce[12] ‖ ciphertext+tag).
 */
object IDokladCrypto {

    private const val GCM_NONCE_LEN = 12
    private const val GCM_TAG_LEN_BITS = 128

    private val key: SecretKeySpec by lazy {
        val b64 = System.getenv("IDOKLAD_ENC_KEY")?.takeIf { it.isNotBlank() }
            ?: System.getenv("JWT_SECRET")?.let { fallback -> deriveKey(fallback) }
            ?: error("Není nastaven IDOKLAD_ENC_KEY ani JWT_SECRET — credentials nelze šifrovat.")
        val raw = if (b64.length == 44 || b64.length == 43) {
            // base64 of 32 bytes
            runCatching { Base64.getDecoder().decode(b64) }.getOrElse { deriveKeyBytes(b64) }
        } else {
            deriveKeyBytes(b64)
        }
        require(raw.size == 32) { "Master key musí být 32 bajtů (AES-256)." }
        SecretKeySpec(raw, "AES")
    }

    /** Deterministicky odvodí 32B z libovolného hesla přes SHA-256. */
    private fun deriveKeyBytes(secret: String): ByteArray {
        return java.security.MessageDigest.getInstance("SHA-256")
            .digest(secret.toByteArray(Charsets.UTF_8))
    }

    private fun deriveKey(secret: String): String {
        return Base64.getEncoder().encodeToString(deriveKeyBytes(secret))
    }

    fun encrypt(plaintext: String): String {
        val nonce = ByteArray(GCM_NONCE_LEN).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LEN_BITS, nonce))
        }
        val ct = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(nonce + ct)
    }

    fun decrypt(b64: String): String {
        val all = Base64.getDecoder().decode(b64)
        require(all.size > GCM_NONCE_LEN) { "Šifrovaný blob je příliš krátký." }
        val nonce = all.copyOfRange(0, GCM_NONCE_LEN)
        val ct = all.copyOfRange(GCM_NONCE_LEN, all.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LEN_BITS, nonce))
        }
        return String(cipher.doFinal(ct), Charsets.UTF_8)
    }
}
