package cz.cointrack.auth

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * Argon2id hashování hesel — pure-Java implementace přes BouncyCastle.
 *
 * Argon2id je OWASP-doporučený algoritmus od roku 2021. Je resistentní proti
 * GPU i ASIC útokům na rozdíl od bcrypt/scrypt.
 *
 * Pure-Java: žádná JNA/native knihovna, běží i na QEMU Virtual CPU
 * (kde native implementace segfaultuje).
 *
 * Výstupní formát je standardní PHC encoded string:
 *   $argon2id$v=19$m=65536,t=3,p=1$<base64_salt>$<base64_hash>
 */
object PasswordHasher {
    // Parametry: iterations=3, memory=64 MB, parallelism=1 (interactive preset)
    private const val ITERATIONS = 3
    private const val MEMORY_KB = 65_536
    private const val PARALLELISM = 1
    private const val HASH_LEN = 32
    private const val SALT_LEN = 16

    private val random = SecureRandom()
    private val b64Encoder = Base64.getEncoder().withoutPadding()
    private val b64Decoder = Base64.getDecoder()

    fun hash(plaintext: String): String {
        val salt = ByteArray(SALT_LEN).also { random.nextBytes(it) }
        val hash = compute(plaintext.toByteArray(Charsets.UTF_8), salt, ITERATIONS, MEMORY_KB, PARALLELISM, HASH_LEN)
        return "\$argon2id\$v=19\$m=$MEMORY_KB,t=$ITERATIONS,p=$PARALLELISM\$" +
            "${b64Encoder.encodeToString(salt)}\$${b64Encoder.encodeToString(hash)}"
    }

    fun verify(encoded: String, plaintext: String): Boolean {
        val parts = encoded.split('$')
        // Expected format: ["", "argon2id", "v=19", "m=...,t=...,p=...", "<salt>", "<hash>"]
        if (parts.size != 6 || parts[1] != "argon2id") return false

        val params = parts[3].split(',').associate {
            val kv = it.split('=')
            kv[0] to kv[1].toInt()
        }
        val m = params["m"] ?: return false
        val t = params["t"] ?: return false
        val p = params["p"] ?: return false

        val salt = runCatching { b64Decoder.decode(parts[4]) }.getOrElse { return false }
        val expected = runCatching { b64Decoder.decode(parts[5]) }.getOrElse { return false }

        val actual = compute(plaintext.toByteArray(Charsets.UTF_8), salt, t, m, p, expected.size)

        // Constant-time comparison
        return MessageDigest.isEqual(actual, expected)
    }

    private fun compute(
        password: ByteArray,
        salt: ByteArray,
        iterations: Int,
        memoryKb: Int,
        parallelism: Int,
        outputLen: Int,
    ): ByteArray {
        val generator = Argon2BytesGenerator()
        generator.init(
            Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
                .withVersion(Argon2Parameters.ARGON2_VERSION_13)
                .withIterations(iterations)
                .withMemoryAsKB(memoryKb)
                .withParallelism(parallelism)
                .withSalt(salt)
                .build()
        )
        val out = ByteArray(outputLen)
        generator.generateBytes(password, out)
        return out
    }
}
