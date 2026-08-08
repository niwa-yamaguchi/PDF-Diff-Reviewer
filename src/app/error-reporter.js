export function createErrorReporter(dom, logger) {
  function targetOrDefault(target) {
    return target || dom.status;
  }

  return Object.freeze({
    user(message, target) {
      targetOrDefault(target).textContent = message;
    },
    report(error, message, target) {
      logger.error(error);
      targetOrDefault(target).textContent = message;
    },
  });
}
