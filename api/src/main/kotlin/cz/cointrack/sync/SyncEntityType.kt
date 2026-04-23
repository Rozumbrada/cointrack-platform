package cz.cointrack.sync

/**
 * Výčet entit, které podporují sync. Používá se pro routing a access control.
 *
 * Entity patří buď uživateli (profiles) nebo profilu (vše ostatní).
 * Sync služba kontroluje, že uživatel má přístup k danému profilu.
 */
enum class SyncEntityType(val key: String, val scope: Scope) {
    PROFILES       ("profiles",      Scope.USER),
    ACCOUNTS       ("accounts",      Scope.PROFILE),
    CATEGORIES     ("categories",    Scope.PROFILE),
    TRANSACTIONS   ("transactions",  Scope.PROFILE),
    RECEIPTS       ("receipts",      Scope.PROFILE),
    RECEIPT_ITEMS  ("receipt_items", Scope.RECEIPT),
    INVOICES       ("invoices",      Scope.PROFILE),
    INVOICE_ITEMS  ("invoice_items", Scope.INVOICE);

    enum class Scope { USER, PROFILE, RECEIPT, INVOICE }

    companion object {
        fun fromKey(key: String): SyncEntityType? = entries.firstOrNull { it.key == key }
    }
}
