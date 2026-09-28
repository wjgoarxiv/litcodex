import { canonicalJson, isRecord, sha256 } from "./strict-input.mjs";

const HASH = /^[0-9a-f]{64}$/;
const EVIDENCE_BYTES_KEYS = new Set(["manifest", "inventory", "inventory_items", "capture_base64"]);

function canonicalBase64(value, label, issues) {
	if (typeof value !== "string") {
		issues.push(`${label} must be a base64 string`);
		return Buffer.alloc(0);
	}
	const bytes = Buffer.from(value, "base64");
	if (bytes.length === 0) issues.push(`${label} must contain nonempty evidence bytes`);
	if (bytes.toString("base64") !== value) issues.push(`${label} is not canonical base64`);
	return bytes;
}

export function evidenceByteHashes(value, manifest) {
	const issues = [];
	if (!isRecord(value)) return { issues: ["evidence_bytes must be an object"], hashes: [] };
	for (const key of Object.keys(value)) {
		if (!EVIDENCE_BYTES_KEYS.has(key)) issues.push(`evidence_bytes contains unknown key ${key}`);
	}
	if (
		typeof value.manifest !== "string" ||
		typeof value.inventory !== "string" ||
		!isRecord(value.inventory_items)
	) {
		return { issues: [...issues, "evidence_bytes manifest, inventory, and inventory_items are invalid"], hashes: [] };
	}
	const expectedManifest = canonicalJson({ ...manifest, review_receipt_hashes: [] });
	const expectedInventory = canonicalJson(manifest.inventory);
	if (value.manifest !== expectedManifest) issues.push("manifest evidence bytes do not match the manifest");
	if (value.inventory !== expectedInventory) issues.push("inventory evidence bytes do not match the manifest inventory");

	const captured = new Map();
	for (const entry of Array.isArray(manifest.inventory) ? manifest.inventory : []) {
		if (isRecord(entry) && entry.status === "captured" && typeof entry.id === "string") {
			captured.set(entry.id, entry.evidence_hash);
		}
	}
	const itemIds = Object.keys(value.inventory_items).sort();
	const expectedIds = [...captured.keys()].sort();
	if (JSON.stringify(itemIds) !== JSON.stringify(expectedIds)) {
		issues.push("inventory item evidence keys do not exactly match captured inventory ids");
	}
	for (const id of itemIds) {
		const bytes = canonicalBase64(value.inventory_items[id], `inventory item ${id}`, issues);
		const expectedHash = captured.get(id);
		if (typeof expectedHash !== "string" || !HASH.test(expectedHash) || sha256(bytes) !== expectedHash) {
			issues.push(`inventory evidence_hash does not match evidence bytes for ${id}`);
		}
	}
	const capture = canonicalBase64(value.capture_base64, "capture evidence", issues);
	const captureHash = sha256(capture);
	if (manifest.capture_hash !== captureHash) issues.push("capture_hash does not match capture evidence bytes");
	const inventorySubject = canonicalJson({
		inventory: value.inventory,
		inventory_items: value.inventory_items,
	});
	return { issues, hashes: [sha256(value.manifest), sha256(inventorySubject), captureHash] };
}
