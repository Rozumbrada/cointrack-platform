package cz.cointrack.auth

import de.mkammerer.argon2.Argon2Factory

/**
 * Argon2id pro hashování hesel. Parametry jsou default "interactive" preset.
 *
 * Argon2id je OWASP-doporučený algoritmus od roku 2021. Je resistentní proti
 * GPU i ASIC útokům na rozdíl od bcrypt/scrypt.
 */
object PasswordHasher {
    private val argon2 = Argon2Factory.create(Argon2Factory.Argon2Types.ARGON2id)

    // Parametry: iterations=3, memory=65536 KB (64 MB), parallelism=1
    private const val ITERATIONS = 3
    private const val MEMORY_KB = 65_536
    private const val PARALLELISM = 1

    fun hash(plaintext: String): String {
        val chars = plaintext.toCharArray()
        try {
            return argon2.hash(ITERATIONS, MEMORY_KB, PARALLELISM, chars)
        } finally {
            argon2.wipeArray(chars)
        }
    }

    fun verify(hash: String, plaintext: String): Boolean {
        val chars = plaintext.toCharArray()
        try {
            return argon2.verify(hash, chars)
        } finally {
            argon2.wipeArray(chars)
        }
    }
}
