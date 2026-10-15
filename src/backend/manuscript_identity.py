"""Stable identity for manuscript numbers across revision rounds."""
import re
import unicodedata

REVISION = re.compile(r'(?:[._-]?R(?:EV(?:ISION)?)?[._ -]*(\d+)|\s*\(R(\d+)\))$', re.I)


def number_key(value):
    return unicodedata.normalize('NFKC', value or '').strip().casefold()


def series(value):
    key = number_key(value)
    return REVISION.sub('', key).rstrip(' ._-')


def round_number(value):
    match = REVISION.search(number_key(value))
    return int(match[1] or match[2]) if match else 0


def title_key(value):
    return ' '.join(unicodedata.normalize('NFKC', value or '').split()).casefold()
