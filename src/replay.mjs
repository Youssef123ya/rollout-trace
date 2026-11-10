export const sampleQuestion = "After changing a zip-deployed AWS Lambda from Node.js 18 to Node.js 20, connections to Amazon RDS fail with 'unable to verify the first certificate'. What changed, and what should we verify first?";

const loadingChange = "Starting with Node.js 20, Lambda no longer loads additional CA certificates by default.";
const remedy = "Set the NODE_EXTRA_CA_CERTS environment variable to /var/runtime/ca-cert.pem.";

export const replayEvidence = [
  {
    title: "Building Lambda event functions with Node.js · CA certificate loading",
    url: "https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html",
    content: loadingChange,
  },
  {
    title: "Using AWS Lambda with Amazon RDS · SSL/TLS requirements",
    url: "https://docs.aws.amazon.com/lambda/latest/dg/services-rds.html",
    content: "Node.js 20 and later: Lambda no longer loads additional CA certificates by default. " + remedy,
  },
];

export const replayReport = {
  findings: [
    {
      kind: "documented",
      statement: "Lambda stopped loading the additional Amazon CA certificates by default starting with the Node.js 20 runtime.",
      citations: [{ sourceId: "S1", quote: loadingChange }],
    },
    {
      kind: "inference",
      statement: "For this example, a missing CA bundle is consistent with the certificate error after the runtime change. Check which CA bundle the database client is loading.",
      citations: [{ sourceId: "S1", quote: loadingChange }],
    },
    {
      kind: "documented",
      statement: "For a ZIP deployment on this runtime, AWS documents loading the Amazon CA bundle via NODE_EXTRA_CA_CERTS=/var/runtime/ca-cert.pem.",
      citations: [{ sourceId: "S2", quote: remedy }],
    },
  ],
  gaps: [
    "The example does not include the database client configuration or the actual certificate chain.",
    "Both sources are AWS documentation. They explain the runtime behavior but do not prove this incident’s root cause.",
  ],
  nextChecks: [
    "Compare the environment and TLS client options on the failing version and the last working version.",
    "Test the documented CA setting in staging with TLS verification enabled. Check that the RDS connection succeeds before promoting a change.",
  ],
};
