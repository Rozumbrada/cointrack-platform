package cz.cointrack.plugins

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import io.ktor.server.application.*
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.sql.Database
import javax.sql.DataSource

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
        // Pokud už existuje, nejdřív zavři starou instanci (testovací re-init)
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

        // Flyway migrace
        //
        // baselineOnMigrate(true) + baselineVersion("0") — umožňuje Flyway
        // běžet i nad už existující (manuálně osazenou) databází. Pokud
        // flyway_schema_history je prázdné, vytvoří baseline a pokračuje.
        // validateMigrationNaming(false) — explicitní; Flyway 10.x s Ktor
        // fat-jarem někdy mylně odmítá jinak valid jména (V1.0__foo.sql).
        Flyway.configure()
            .dataSource(_dataSource)
            .locations("classpath:db/migration")
            .baselineOnMigrate(true)
            .baselineVersion("0")
            .validateMigrationNaming(false)
            .load()
            .migrate()

        Database.connect(_dataSource!!)
    }

    /** Používá se v testech pro clean teardown mezi třídami. */
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
