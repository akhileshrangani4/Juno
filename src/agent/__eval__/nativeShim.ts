// Stand-ins for the native modules the evals touch indirectly; they run under Node.
export const Platform = { OS: 'web' };
export const getItemAsync = async () => null;
export const setItemAsync = async () => undefined;
export const deleteItemAsync = async () => undefined;
