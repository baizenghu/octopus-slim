// Node.js 22+ built-in fetch API types
// RequestInfo is a DOM type not included in @types/node,
// but used extensively in fetch-related code
type RequestInfo = string | URL | Request;
