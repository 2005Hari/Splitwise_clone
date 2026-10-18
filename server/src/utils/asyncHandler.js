// Wraps an async Express handler so a rejected promise reaches next(err)
// instead of crashing the process.
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
