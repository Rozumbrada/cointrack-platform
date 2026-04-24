package cz.cointrack.plugins

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import io.ktor.server.application.*
import org.jetbrains.exposed.sql.Database
import org.slf4j.LoggerFactory
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
 * Chování:
 *  1. Založí tabulku `schema_migrations` (pokud neexistuje)
 *  2. Baseline: pokud existuje tabulka `users` ale `schema_migrations` je prázdné,
 *     označí všechny známé migrace jako aplikované (předpoklad: schéma bylo
 *     osazeno manuálně nebo dřívějším nástrojem).
 *  3. Postupně aplikuje každou migraci, která ještě nebyla zaznamenaná.
 *
 * Migrace se čtou z classpath: `/db/migration/V<version>__<desc>.sql`.
 */
private val MIGRATIONS: List<Pair<String, String>> = listOf(
    "1.0" to "/db/migration/V1.0__initial_auth.sql",
    "2.0" to "/db/migration/V2.0__core_entities.sql",
    "3.0" to "/db/migration/V3.0__loyalty_cards.sql",
    "4.0" to "/db/migration/V4.0__remaining_entities.sql",
    "5.0" to "/db/migration/V5.0__organizations.sql",
    "6.0" to "/db/migration/V6.0__profile_permissions.sql",
    "7.0" to "/db/migration/V7.0__org_types.sql",
    "8.0" to "/db/migration/V8.0__group_entities.sql",
    "9.0" to "/db/migration/V9.0__banking.sql",
    "9.1" to "/db/migration/V9.1__banking_jsonb_to_text.sql",
)

private fun runMigrations(dataSource: DataSource) {
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
            migrationLog.info("Schema baseline: 'users' existuje ale schema_migrations je prázdná. Označuji všechny známé migrace jako aplikované.")
            for ((version, _) in MIGRATIONS) {
                conn.prepareStatement(
                    "INSERT INTO schema_migrations (version) VALUES (?) ON CONFLICT DO NOTHING"
                ).use {
                    it.setString(1, version)
                    it.executeUpdate()
                }
            }
            return
        }

        // 3. Aplikuj nové migrace
        for ((version, path) in MIGRATIONS) {
            val alreadyApplied = conn.prepareStatement(
                "SELECT 1 FROM schema_migrations WHERE version = ?"
            ).use { stmt ->
                stmt.setString(1, version)
                stmt.executeQuery().use { it.next() }
            }
            if (alreadyApplied) continue

            val sql = DatabaseSingleton::class.java.getResourceAsStream(path)
                ?.bufferedReader()?.readText()
                ?: error("Migrace nenalezena na classpath: $path")

            migrationLog.info("Aplikuji migraci $version ($path)...")
            conn.autoCommit = false
            try {
                conn.createStatement().use { it.execute(sql) }
                conn.prepareStatement("INSERT INTO schema_migrations (version) VALUES (?)").use {
                    it.setString(1, version)
                    it.executeUpdate()
                }
                conn.commit()
                migrationLog.info("Migrace $version OK.")
            } catch (e: Exception) {
                conn.rollback()
                migrationLog.error("Migrace $version selhala, rollback.", e)
                throw e
            } finally {
                conn.autoCommit = true
            }
        }
    }
}
