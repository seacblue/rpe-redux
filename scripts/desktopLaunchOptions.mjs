/** Parse the per-process desktop port flags used by parallel development runs. */

/** Validate one stable desktop port value. */
function portValue(flag, value) {
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${flag} must be an integer between 1 and 65535.`);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${flag} must be between 1 and 65535.`);
  }
  return port;
}

/** Read `--<name>-port` in either equals or separated-value form. */
export function desktopPortArgument(argv, name) {
  const flag = `--${name}-port`;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith(`${flag}=`)) {
      return portValue(flag, argument.slice(flag.length + 1));
    }
    if (argument === flag) {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`${flag} requires a port value.`);
      }
      return portValue(flag, value);
    }
  }
  return undefined;
}
