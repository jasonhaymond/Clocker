// Generates the copy-pasteable shell commands for setting up a dedicated, restricted
// backup user on a remote Borg server — shown in both clients' Backups screen alongside
// the generated SSH key. Pure string templating (no client-specific APIs) so both clients
// render the exact same instructions from the exact same logic. Mirrors Haydrop's own
// documented setup (docs/deployment-guide.md there) almost line-for-line — same
// `adduser`/`install -d`/`touch` shape, same `/srv/<user>/...` layout — and the path/
// restriction convention already documented in docs/deployment.md#the-host-agent. Keep
// all three in sync if any of them change.

const DEFAULT_USERNAME = "clocker-backup";
const DEFAULT_HOME = `/srv/${DEFAULT_USERNAME}`;
const DEFAULT_REPO_PATH = `${DEFAULT_HOME}/repositories/clocker`;

// `repoUrl` is whatever the user has typed into "Repo URL" — usually still their own
// personal login (e.g. "jason@nextcloud:/mnt/backups/clocker") until they've actually
// created the dedicated user and switched the field over to it. Parsed on a best-effort
// basis just to prefill a sensible host/path in the generated script; a local path or an
// empty field falls back to a generic placeholder host and the documented default path
// instead of guessing.
function parseSshRepoUrl(repoUrl: string | undefined): { host: string; path: string } {
  const match = (repoUrl ?? "").match(/^[^@\s]+@([^:\s]+):(.+)$/);
  if (match) return { host: match[1], path: match[2] || DEFAULT_REPO_PATH };
  return { host: "<your-server>", path: DEFAULT_REPO_PATH };
}

export function buildBackupRemoteUserScript(params: { repoUrl?: string; sshPublicKey?: string | null }): string {
  const { host, path } = parseSshRepoUrl(params.repoUrl);
  const pubKey = params.sshPublicKey?.trim() || "<paste the public key shown above>";
  const user = DEFAULT_USERNAME;
  const home = `/srv/${user}`;
  const sshDir = `${home}/.ssh`;

  return [
    `# Run these on the REMOTE backup server (${host}), as an admin/sudo user —`,
    `# not on this app's own server.`,
    "",
    "sudo apt update",
    "sudo apt install -y borgbackup openssh-server",
    "",
    `sudo adduser --system --group --shell /bin/bash --home ${home} ${user}`,
    `sudo install -d -o ${user} -g ${user} -m 700 ${path}`,
    `sudo install -d -o ${user} -g ${user} -m 700 ${sshDir}`,
    `sudo touch ${sshDir}/authorized_keys`,
    `sudo chown ${user}:${user} ${sshDir}/authorized_keys`,
    `sudo chmod 600 ${sshDir}/authorized_keys`,
    "",
    "# Append the restricted command + this app's dedicated public key (shown above) —",
    '# this is what actually locks the account down to only running "borg serve" against',
    "# this one repository, so the key is useless for anything else even if it were ever",
    "# leaked, regardless of the account's own shell:",
    `echo 'command="borg serve --restrict-to-repository ${path}",restrict ${pubKey}' | sudo tee -a ${sshDir}/authorized_keys`,
    "",
    "# Borg initializes the repository itself on the first backup — nothing more to",
    "# do here beyond creating the empty directory above.",
    "",
    "# Then set \"Repo URL\" above to:",
    `${user}@${host}:${path}`,
  ].join("\n");
}
