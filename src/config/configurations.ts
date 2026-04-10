// src/configurations.ts
export default () => {
  return {
    appRoles: JSON.parse(process.env.ROLES),
  };
};

export const something = {
  _id: '08ritesh@gmail.com',
  totalTimeInSession: 188,
  registeredWebinarCount: 7,
  attendedWebinarCount: 2,
  locations: ['india', null],
  sources: [null],
  phones: ['9819060779', '9819060712'],
  tags: ['', 'prod1212', 'qwqw', 'wqqwqwq'],
  enrollments: ['dsfsdf (1) - 12', 'Vritti Larson (1) - 1212', 'w12 (3) - 12'],
  fullNames: ['Ritesh P', 'firstname lastname'],
};
