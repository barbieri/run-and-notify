export const splitLines = (value: string): string[] => {
  if (value.length === 0) {
    return [];
  }

  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '').split('\n');
};
