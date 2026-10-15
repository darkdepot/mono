// Shared publication/landing validation; confirmation is a separate barrier.
export function validateShipCertificate(report, repo) {
  const certificate = report.certificate;
  if (typeof certificate !== "string" || certificate.split("mono-ship green certificate").length !== 2)
    throw new Error("one green ship certificate required");
  const field = name => {
    const values = certificate.split("\n").filter(line => line.startsWith(`${name}: `)).map(line => line.slice(name.length + 2).trim());
    if (values.length !== 1) throw new Error(`ship certificate ${name} missing or ambiguous`);
    return values[0];
  };
  if (field("Ship") !== "green" || field("Issue(s)") !== report.issue || field("Head SHA") !== report.head)
    throw new Error("ship certificate issue/head mismatch");
  if (repo !== undefined && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("invalid record repository");
  let remaining = field("PR"), pr, urlRepo;
  const component = /^(?:https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)|#?([1-9][0-9]*))(?=$|[\s/,\[\]()])/;
  while (remaining) {
    remaining = remaining.replace(/^[\s/,\[\]()]+/, "");
    if (!remaining) break;
    const match = component.exec(remaining);
    if (!match) throw new Error("ship certificate PR must contain only GitHub PR URLs and numbers");
    const number = Number(match[2] ?? match[3]);
    if (!Number.isSafeInteger(number)) throw new Error("invalid ship certificate PR number");
    if (pr !== undefined && number !== pr) throw new Error("ship certificate PR numbers mismatch");
    if (match[1] && urlRepo !== undefined && match[1] !== urlRepo) throw new Error("ship certificate URL repositories mismatch");
    pr = number;
    urlRepo ??= match[1];
    remaining = remaining.slice(match[0].length);
  }
  if (pr === undefined) throw new Error("ship certificate PR requires a GitHub PR URL or number");
  if (urlRepo && repo !== undefined && urlRepo !== repo) throw new Error("ship certificate repository mismatch");
  repo ??= urlRepo;
  return { repo, pr, head: report.head };
}
