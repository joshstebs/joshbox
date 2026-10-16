"""Install the bundled export without overwriting custom runtime configuration."""
import os
from pathlib import Path
import shlex
import shutil
import sys


def install(env_file):
    env_file = Path(env_file)
    # Keep the installed graph beside the protected runtime file, outside Git.
    destination = env_file.parent / 'joshbox-workflows' / 'wan22-5b-quality.json'
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copyfile(Path(__file__).resolve().parent.parent / 'workflows' / destination.name, destination)
    os.chmod(destination, 0o600)
    key = 'WORKFLOW_WAN5_QUALITY_PATH'
    lines = env_file.read_text(encoding='utf-8').splitlines()
    matches = [i for i, line in enumerate(lines) if line.startswith(key + '=')]
    if len(matches) > 1:
        raise ValueError('Duplicate Wan Quality settings; runtime file preserved.')
    assignment = key + '=' + shlex.quote(str(destination.resolve()))
    if not matches:
        lines.append(assignment)
    elif lines[matches[0]].split('=', 1)[1].strip() in ('', "''", '""'):
        lines[matches[0]] = assignment
    else:
        return destination  # Preserve an existing operator-selected workflow.
    temporary = env_file.with_suffix(env_file.suffix + '.tmp')
    with temporary.open('w', encoding='utf-8', newline='\n') as output:
        os.chmod(temporary, 0o600)
        output.write('\n'.join(lines) + '\n')
    temporary.replace(env_file)
    return destination


if __name__ == '__main__':
    install(sys.argv[1])
