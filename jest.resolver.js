module.exports = (request, options) => {
  try {
    return options.defaultResolver(request, options);
  } catch (error) {
    try {
      return options.defaultResolver(request, { ...options, conditions: ['import', 'default'] });
    } catch {
      throw error;
    }
  }
};
