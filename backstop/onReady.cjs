const { flows, fonts } = require("./flows.cjs");

module.exports = async (page, scenario, viewport) => {
  const flow = flows[scenario.flow];
  if (!flow) {
    throw new Error(`No Backstop flow registered for ${scenario.flow}`);
  }

  await flow(page, scenario, viewport);
  await fonts(page);
};
