
/** MOCK of the addon's currentUser observable. */
export const control = { currentUserValue: undefined, subscribers: [] };
export const db = {
  cloud: {
    get currentUser() {
      return {
        get value() { return control.currentUserValue; },
        subscribe(fn) {
          control.subscribers.push(fn);
          return { unsubscribe() {} };
        },
      };
    },
  },
};
