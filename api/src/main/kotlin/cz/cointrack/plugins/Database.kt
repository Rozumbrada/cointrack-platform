package cz.cointrack.plugins

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import io.ktor.server.application.*
import org.jetbrains.exposed.sql.Database
import org.slf4j.LoggerFactory
import java.io.File
import java.util.jar.JarFile
import javax.sql.DataSource

private val migrationLog = LoggerFactory.getLogger("DatabaseMigrations")

object DatabaseSingleton {
    private var _dataSource: HikariDataSource? = null

    val dataSource: DataSource
        get() = _dataSource ?: error("Database not initialized")

    fun init(
        host: String,
        port: Int,
        name: String,
        user: String,
        password: String,
    ) {
        close()

        val config = HikariConfig().apply {
            jdbcUrl = "jdbc:postgresql://$host:$port/$name"
            driverClassName = "org.postgresql.Driver"
            username = user
            this.password = password
            maximumPoolSize = 10
            minimumIdle = 2
            isAutoCommit = false
            transactionIsolation = "TRANSACTION_REPEATABLE_READ"
            validate()
        }
        _dataSource = HikariDataSource(config)

        runMigrations(_dataSource!!)

        Database.connect(_dataSource!!)
    }

    fun close() {
        _dataSource?.close()
        _dataSource = null
    }
}

fun Application.configureDatabase() {
    val dbConfig = environment.config.config("database")
    DatabaseSingleton.init(
        host = dbConfig.property("host").getString(),
        port = dbConfig.property("port").getString().toInt(),
        name = dbConfig.property("name").getString(),
        user = dbConfig.property("user").getString(),
        password = dbConfig.property("password").getString(),
    )
    log.info("Database initialized and migrations applied.")
}

/**
 * Vlastní SQL migrace — nahrazuje Flyway kvůli bugu s detekcí jmen
 * v Ktor fat-jaru (Flyway 10.21 odmítl i jména odpovídající default regex).
 *
 * Migrace se čtou z classpath: `/db/migration/V<version>__<desc>.sql`.
 *
 * Auto-discovery: seznam migrací se načítá ze classpath dynamicky (oproti dřívější
 * hardcoded variantě, kde se zapomnělo přidávat nové). Detekce zvládá:
 *   - Spuštění z fat-jaru (production) — čte přes JarFile.entries()
 *   - Spuštění z `build/resources/main/` (dev/IDE) — čte přes File.listFiles()
 *
 * Verze ve filename `V19.0__name.sql` → klíč `19.0`. Sortováno čísly nikoli
 * lexikálně, aby `9.0 < 10.0 < 19.0`.
 */
private val MIGRATION_NAME_RE = Regex("^V(\\d+(?:\\.\\d+)?)__.*\\.sql$")

/**
 * Známé baseline migrace — pokud user má `users` tabulku ale prázdné
 * schema_migrations, naseje se těmito jako aplikované (znamená že byly
 * spuštěné manuálně dřív). Nové migrace nad tento seznam se aplikují normálně.
 */
private val BASELINE_MIGRATIONS: List<String> = listOf(
    "1.0", "2.0", "3.0", "4.0", "5.0", "6.0", "7.0", "8.0",
    "9.0", "9.1", "10.0", "11.0", "12.0", "13.0", "14.0",
    "15.0", "16.0", "17.0", "18.0",
)

private data class Migration(val version: String, val resourcePath: String)

private fun discoverMigrations(): List<Migration> {
    val resourceUrl = DatabaseSingleton::class.java.getResource("/db/migration")
        ?: error("Migrace složka /db/migration nenalezena na classpath.")

    val files: List<String> = when (resourceUrl.protocol) {
        "jar" -> {
            // jar:file:/app/app.jar!/db/migration  →  /app/app.jar
            val jarPath = resourceUrl.path.substringBefore("!").removePrefix("file:")
            JarFile(jarPath).use { jar ->
                jar.entries().asSequence()
                    .map { it.name }
                    .filter { it.startsWith("db/migration/") && it.endsWith(".sql") }
                    .map { it.substringAfterLast("/") }
                    .toList()
            }
        }
        "file" -> {
            File(resourceUrl.toURI()).listFiles()
                ?.map { it.name }
                ?.filter { it.endsWith(".sql") }
                ?: emptyList()
        }
        else -> error("Neznámý protokol classpath URL: ${resourceUrl.protocol}")
    }

    val migrations = files.mapNotNull { name ->
        val match = MIGRATION_NAME_RE.matchEntire(name) ?: run {
            migrationLog.warn("Ignoruji neplatný název migrace: $name (musí být V<X>[.<Y>]__name.sql)")
            return@mapNotNull null
        }
        Migration(version = match.groupValues[1], resourcePath = "/db/migration/$name")
    }

    return migrations.sortedWith(compareBy({ versionMajor(it.version) }, { versionMinor(it.version) }))
}

private fun versionMajor(v: String): Int = v.substringBefore(".").toIntOrNull() ?: 0
private fun versionMinor(v: String): Int = v.substringAfter(".", "").toIntOrNull() ?: 0

private fun runMigrations(dataSource: DataSource) {
    val migrations = discoverMigrations()
    migrationLog.info("Detekováno ${migrations.size} migrací: ${migrations.joinToString(", ") { it.version }}")

    dataSource.connection.use { conn ->
        conn.autoCommit = true

        // 1. Tracking tabulka
        conn.createStatement().use {
            it.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version     TEXT         PRIMARY KEY,
                    applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
                )
                """.trimIndent()
            )
        }

        // 2. Baseline: schéma už existuje, ale není trackováno
        val hasUsers = conn.metaData.getTables(null, "public", "users", null).use { it.next() }
        val trackedCount = conn.prepareStatement("SELECT COUNT(*) FROM schema_migrations").use { stmt ->
            stmt.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
        }

        if (hasUsers && trackedCount == 0) {
            migrationLog.info("Schema baseline: 'users' existuje ale schema_migrations je prázdná. " +
                "Označuji baseline migrace (${BASELINE_MIGRATIONS.size}) jako aplikované; " +
                "novější se normálně aplikují.")
            for (version in BASELINE_MIGRATIONS) {
                conn.prepareStatement(
                    "INSERT INTO schema_migrations (version) VALUES (?) ON CONFLICT DO NOTHING"
                ).use {
                    it.setString(1, version)
                    it.executeUpdate()
                }
            }
        }

        // 3. Aplikuj všechny migrace, které ještě nejsou v schema_migrations
        for (mig in migrations) {
            val alreadyApplied = conn.prepareStatement(
                "SELECT 1 FROM schema_migrations WHERE version = ?"
            ).use { stmt ->
                stmt.setString(1, mig.version)
                stmt.executeQuery().use { it.next() }
            }
            if (alreadyApplied) continue

            val sql = DatabaseSingleton::class.java.getResourceAsStream(mig.resourcePath)
                ?.bufferedReader()?.readText()
                ?: error("Migrace nenalezena na classpath: ${mig.resourcePath}")

            migrationLog.info("Aplikuji migraci ${mig.version} (${mig.resourcePath})…")
            conn.autoCommit = false
            try {
                conn.createStatement().use { it.execute(sql) }
                conn.prepareStatement("INSERT INTO schema_migrations (version) VALUES (?)").use {
                    it.setString(1, mig.version)
                    it.executeUpdate()
                }
                conn.commit()
                migrationLog.info("Migrace ${mig.version} OK.")
            } catch (e: Exception) {
                conn.rollback()
                migrationLog.error("Migrace ${mig.version} selhala, rollback.", e)
                throw e
            } finally {
                conn.autoCommit = true
            }
        }
    }
}
