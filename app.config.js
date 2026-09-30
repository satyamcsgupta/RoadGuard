const { expo } = require("./app.json");

module.exports = {
  ...expo,
  extra: {
    ...expo.extra,
    eas: {
      ...expo.extra?.eas,
      projectId: "d1cadf3d-9944-434e-bd48-a5d970496714",
    },
  },
};