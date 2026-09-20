"""Validate <contract>.<example>.json fixtures against local schemas."""

import json
import sys
from pathlib import Path

from jsonschema.validators import validator_for
from referencing import Registry, Resource
from referencing.exceptions import Unresolvable


def main() -> int:
    contracts = Path(__file__).resolve().parent
    schemas = {
        path.name: json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(contracts.glob("*.schema.json"))
    }
    registry = Registry().with_resources(
        (schema["$id"], Resource.from_contents(schema))
        for schema in schemas.values()
    )
    validators = {}
    for name, schema in schemas.items():
        validator = validator_for(schema)
        validator.check_schema(schema)
        validators[name] = validator(schema, registry=registry)

    fixtures = sorted((contracts / "fixtures").glob("*.json"))
    if not fixtures:
        print(
            "contracts/fixtures: expected at least one JSON fixture",
            file=sys.stderr,
        )
        return 1

    failed = False
    for fixture in fixtures:
        name = fixture.relative_to(contracts.parent)
        schema_name = fixture.name.split(".", 1)[0] + ".schema.json"
        if schema_name not in validators:
            print(
                f"{name}: $: expected matching schema {schema_name}",
                file=sys.stderr,
            )
            failed = True
            continue
        try:
            instance = json.loads(fixture.read_text(encoding="utf-8"))
            errors = sorted(
                validators[schema_name].iter_errors(instance),
                key=lambda error: error.json_path,
            )
        except (OSError, json.JSONDecodeError, Unresolvable) as error:
            print(
                f"{name}: $: validation could not complete: {error}",
                file=sys.stderr,
            )
            failed = True
            continue
        for error in errors:
            print(
                f"{name}: {error.json_path}: {error.message} "
                f"({error.validator}={error.validator_value!r})",
                file=sys.stderr,
            )
            failed = True

    if failed:
        return 1
    print(f"contracts: {len(fixtures)} fixtures validate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
