/** JSON that is safe inside an inline <script>: no `</script>` break-out, and the
 *  two line separators that older engines treat as line breaks inside a string. */
export const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/[\u2028\u2029]/g, (c) => (c === " " ? "\\u2028" : "\\u2029"));
