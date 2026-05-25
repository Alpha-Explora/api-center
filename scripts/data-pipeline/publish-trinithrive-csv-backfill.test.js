const assert = require("node:assert/strict");

const {
  buildEventType,
  filterEventsByKeys,
  isUnauthorizedError,
  parseCsv,
  sanitizeRow,
} = require("./publish-trinithrive-csv-backfill");

{
  const rows = parseCsv('id,name,notes\n1,"A, B","said ""hi"""');

  assert.deepEqual(rows, [{ id: "1", name: "A, B", notes: 'said "hi"' }]);
}

{
  const result = sanitizeRow({
    id: "abc",
    first_name: "Jane",
    last_name: "Doe",
    contact_email: "jane@example.test",
    contact_phone: "555",
    address: "123 Main",
    status: "active",
    quantity: "42",
  });

  assert.deepEqual(result.payload, {
    id: "abc",
    status: "active",
    quantity: 42,
  });
  assert.deepEqual(result.redactedFields.sort(), [
    "address",
    "contact_email",
    "contact_phone",
    "first_name",
    "last_name",
  ]);
}

{
  assert.equal(
    buildEventType("volunteer_shifts_rows_1.csv"),
    "trinithrive.volunteer_shifts.snapshot",
  );
}

{
  assert.equal(
    isUnauthorizedError(
      new Error(
        'HTTP POST /api/v1/auth/token failed with 401: {"error":{"code":"UNAUTHORIZED"}}',
      ),
    ),
    true,
  );
}

{
  const filtered = filterEventsByKeys(
    [{ key: "keep" }, { key: "skip" }],
    new Set(["keep"]),
  );
  assert.deepEqual(filtered, [{ key: "keep" }]);
}

console.log("publish-trinithrive-csv-backfill tests passed");
