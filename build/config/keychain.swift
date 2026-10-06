import Foundation
import Security

// Passwords travel only through stdin/stdout, never command-line arguments.
let service = "local.papertrail.desktop.journal-login"
let previousServices = ["local.paperdesk.desktop.journal-login", "local.paperdesk.journal-login"]

func lookup(_ query: [String: Any]) -> (OSStatus, Data?) {
    var request = query
    request[kSecReturnData as String] = true
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    return (status, result as? Data)
}

func save(_ query: [String: Any], data: Data, label: String) -> OSStatus {
    let values: [String: Any] = [kSecValueData as String: data, kSecAttrLabel as String: label]
    var status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
    if status == errSecItemNotFound {
        var item = query
        for (key, value) in values { item[key] = value }
        status = SecItemAdd(item as CFDictionary, nil)
    }
    return status
}

func migrate(_ query: [String: Any], label: String) -> (OSStatus, Data?, Bool) {
    let existing = lookup(query)
    if existing.0 == errSecSuccess { return (existing.0, existing.1, false) }
    if existing.0 != errSecItemNotFound { return (existing.0, nil, false) }
    for previousService in previousServices {
        var previous = query
        previous[kSecAttrService as String] = previousService
        let original = lookup(previous)
        if original.0 == errSecItemNotFound { continue }
        guard original.0 == errSecSuccess, let data = original.1 else {
            return (original.0, nil, false)
        }
        let status = save(query, data: data, label: label)
        guard status == errSecSuccess else { return (status, nil, false) }
        let checked = lookup(query)
        guard checked.0 == errSecSuccess, checked.1 == data else {
            return (checked.0 == errSecSuccess ? errSecDecode : checked.0, nil, false)
        }
        // Only remove the old item after the new item has been verified byte-for-byte.
        let removed = SecItemDelete(previous as CFDictionary)
        guard removed == errSecSuccess || removed == errSecItemNotFound else {
            return (removed, nil, false)
        }
        return (errSecSuccess, data, true)
    }
    return (errSecItemNotFound, nil, false)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
do {
    guard let request = try JSONSerialization.jsonObject(with: input) as? [String: String],
          let account = request["account"], let operation = request["operation"] else { exit(2) }
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service, kSecAttrAccount as String: account]
    let label = "PaperTrail · " + (request["label"] ?? "Journal account")
    if operation == "get" || operation == "migrate" {
        let result = migrate(query, label: label)
        guard result.0 == errSecSuccess, let data = result.1 else { exit(1) }
        if operation == "get" { FileHandle.standardOutput.write(data) }
        else { print(result.2 ? "migrated" : "ready") }
        exit(0)
    }
    if operation == "delete" {
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { print("deleted"); exit(0) }
        exit(1)
    }
    guard let password = request["password"] else { exit(2) }
    let data = Data(password.utf8)
    if operation == "verify" {
        let result = lookup(query)
        guard result.0 == errSecSuccess, result.1 == data else { exit(1) }
        print("verified"); exit(0)
    }
    guard operation == "save" else { exit(2) }
    let status = save(query, data: data, label: label)
    if status == errSecSuccess { print("saved") }
    else { FileHandle.standardError.write(Data("Keychain status: \(status)".utf8)); exit(1) }
} catch { exit(2) }
