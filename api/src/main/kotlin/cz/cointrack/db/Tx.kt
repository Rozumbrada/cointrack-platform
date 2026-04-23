package cz.cointrack.db

import kotlinx.coroutines.Dispatchers
import org.jetbrains.exposed.sql.transactions.experimental.newSuspendedTransaction

/**
 * Krátká helper funkce: `db { ... }` místo `newSuspendedTransaction(Dispatchers.IO) { ... }`.
 */
suspend fun <T> db(block: suspend org.jetbrains.exposed.sql.Transaction.() -> T): T =
    newSuspendedTransaction(Dispatchers.IO) { block() }
