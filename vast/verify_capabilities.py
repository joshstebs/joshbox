"""Check the private wrapper without putting its bearer token in process arguments."""
import os
import sys

import httpx


def verify(url):
    token = os.environ.get('VIDEO_PROXY_TOKEN', '')
    if len(token) < 32:
        return False
    try:
        response = httpx.get(
            url.rstrip('/') + '/api/capabilities',
            headers={'Authorization': 'Bearer ' + token},
            timeout=5,
            follow_redirects=False,
        )
        response.raise_for_status()
        value = response.json()
        return isinstance(value, dict) and value.get('connected') is True
    except (httpx.HTTPError, ValueError):
        return False


if __name__ == '__main__':
    sys.exit(0 if verify(sys.argv[1]) else 1)
