const { flows, fonts } = require("./flows.cjs");

module.exports = async (page, scenario, viewport, _isReference, browserContext) => {
  const flow = flows[scenario.flow];
  if (!flow) {
    throw new Error(`No Backstop flow registered for ${scenario.flow}`);
  }

  await flow(page, scenario, viewport, browserContext);
  await fonts(page);
};
