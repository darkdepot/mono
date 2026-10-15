"""Regenerate output fixtures using an external, pinned upstream helper; no model call."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

COMMIT = '05d42d1fe0a76d00e339d7b80d248c27b0ea34d9'
source = Path(sys.argv[1]).resolve()
assert subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip() == COMMIT
helper = source / 'skills/autoreview/scripts/autoreview'
assert subprocess.run(['git', '-C', str(source), 'diff', '--exit-code', 'HEAD', '--', 'skills/autoreview'], check=True).returncode == 0
loader = SourceFileLoader('upstream_autoreview', str(helper))
spec = importlib.util.spec_from_loader(loader.name, loader)
module = importlib.util.module_from_spec(spec)
loader.exec_module(module)
output = Path(__file__).resolve().parent
report = {'findings': [], 'overall_correctness': 'patch is correct',
          'overall_explanation': 'No actionable findings in the selected branch.', 'overall_confidence': 0.9}
finding = {'title': 'Preserve the required value', 'body': 'The changed branch drops the required value.',
           'priority': 'P2', 'confidence': 0.9, 'category': 'bug',
           'code_location': {'file_path': 'example.py', 'line': 1}}
with tempfile.TemporaryDirectory(prefix='mono-helper-capture-') as scratch:
    root = Path(scratch)
    repo = root / 'repo'
    repo.mkdir()
    def git(*args):
        return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()
    git('init', '-b', 'fixture')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    (repo / 'example.py').write_text('value = 1\n')
    git('add', 'example.py')
    git('commit', '-m', 'base')
    base = git('rev-parse', 'HEAD')
    (repo / 'example.py').write_text('value = None\n')
    git('commit', '-am', 'candidate')
    original = Path.cwd()
    try:
        os.chdir(repo)
        for outcome in ('clean', 'findings'):
            candidate = copy.deepcopy(report)
            if outcome == 'findings':
                candidate.update(findings=[finding], overall_correctness='patch is incorrect',
                                 overall_explanation='The required value is lost.')
            candidate['review_completion'] = 'complete'
            destination = output / outcome
            destination.mkdir(exist_ok=True)
            argv = ['autoreview', '--mode', 'branch', '--base', base, '--engine', 'claude',
                    '--model', 'claude-opus-5', '--thinking', 'medium', '--max-priority', 'P2',
                    '--json-output', str(destination / 'review.json'),
                    '--status-output', str(destination / 'status.json')]
            stream = io.StringIO()
            # Only engine transport is replaced. Upstream validates the model report,
            # filters priorities, computes the outcome, and writes both artifacts.
            with patch.object(sys, 'argv', argv), patch.object(module, 'run_engine', return_value=json.dumps(candidate)), contextlib.redirect_stdout(stream):
                code = module.main_impl()
            assert code == (0 if outcome == 'clean' else 1)
            # Branch name is fixed; replace the scratch Git base with a stable fixture SHA.
            (destination / 'stdout.txt').write_text(stream.getvalue().replace(base, 'b' * 40))
    finally:
        os.chdir(original)
(output / 'provenance.json').write_text(json.dumps({'repository': 'openclaw/agent-skills',
    'commit': COMMIT, 'path': 'skills/autoreview',
    'helperSha256': hashlib.sha256(helper.read_bytes()).hexdigest()}, indent=2) + '\n')
