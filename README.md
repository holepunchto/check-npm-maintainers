# check-npm-maintainers

Check transitive npm maintainers of all dependencies in a project.

Reports packages where:

- A key owner (e.g. `mafintosh`) is missing from the maintainers
- Maintainers include people not in the trusted owners list
- All maintainers are external (no trusted or key owners)

## Install

```sh
npm i -g check-npm-maintainers@latest
```

## Usage

Create a trusted owners file (one username per line):

```
mafintosh
andrewosh
```

Then run from a project directory with a `package.json`:

```sh
check-npm-maintainers owners.txt
```

## Options

```
--prod                  Only check production dependencies
--key-owner <username>  Key owners to verify (default: mafintosh, can be repeated)
```

## Examples

Check only production dependencies:

```sh
check-npm-maintainers --prod owners.txt
```

Check with multiple key owners:

```sh
check-npm-maintainers --key-owner mafintosh --key-owner andrewosh owners.txt
```
