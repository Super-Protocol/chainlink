const singleFlight = () => {
  const states = new Map();

  return (asyncMethod, key = '') => {
    if (states.has(key)) {
      return states.get(key);
    }

    const deferObject =
      new Promise((resolve, reject) => {
        asyncMethod()
          .then(resolve, reject)
          .finally(() => states.delete(key));
      });

    states.set(key, deferObject);

    return deferObject;
  };
};

module.exports = { singleFlight };
