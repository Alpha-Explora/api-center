// Presentation helpers for messages. Sending goes through ./messaging (ADR-0010).

/**
 * `"Name" <address>` for a From header. The name is reduced to one line of printable text without
 * quotes, angle brackets or backslashes, so it cannot change the address or add a header.
 */
function formatSender(address, name) {
  // eslint-disable-next-line no-control-regex
  const cleaned = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f"<>\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim() : '';
  return cleaned ? `"${cleaned}" <${address}>` : address;
}

module.exports = { formatSender };
