function stringifyError(err) {
  if (!err) {
    return null;
  }

  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
}

function write(level, event, details = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...details,
  };

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

function logInfo(event, details) {
  write("info", event, details);
}

function logWarn(event, details) {
  write("warn", event, details);
}

function logError(event, err, details = {}) {
  write("error", event, {
    ...details,
    error: stringifyError(err),
  });
}

module.exports = {
  logInfo,
  logWarn,
  logError,
};
