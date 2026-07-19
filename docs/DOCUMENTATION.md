# 📚 Documentation

Complete documentation for Bungate - The Lightning-Fast HTTP Gateway & Load Balancer.

## 🚀 Getting Started

### [Quick Start Guide](./QUICK_START.md)

Get up and running with Bungate in less than 5 minutes. Learn how to create your first gateway, add routes, enable load balancing, and add security features.

**Perfect for:** First-time users, quick setup, learning basics

**Contents:**

- Installation
- Your first gateway
- Adding routes and load balancing
- Basic security setup
- Testing your gateway

---

## 🔐 Security & Authentication

### [Authentication Guide](./AUTHENTICATION.md)

Comprehensive guide to authentication and authorization in Bungate. Learn about JWT, API keys, OAuth2, and more.

**Perfect for:** Securing APIs, implementing auth, managing access control

**Contents:**

- JWT authentication (gateway & route-level)
- JWKS (JSON Web Key Set)
- API key authentication
- OAuth2 / OpenID Connect
- Hybrid authentication
- Best practices and troubleshooting

### [Security Guide](./SECURITY.md)

Enterprise-grade security features and best practices for production deployments.

**Perfect for:** Production security, compliance, threat mitigation

**Contents:**

- Threat model
- TLS/HTTPS configuration (redirect host allowlisting, cipher/version mapping)
- Input validation & sanitization (boundary-aware exclusions, encoding validation)
- Security headers
- Session management (bounded sticky sessions)
- Trusted proxy configuration (Cloudflare/X-Real-IP gating)
- Request size limits
- JWT authentication hardening (`exp` required, algorithm derivation, aud/iss support)
- JWT key rotation
- Security checklist

### [TLS Configuration Guide](./TLS_CONFIGURATION.md)

Detailed guide to configuring TLS/HTTPS support with certificates, cipher suites, and HTTP redirection.

**Perfect for:** HTTPS setup, certificate management, secure communications

**Contents:**

- Basic and advanced TLS configuration
- Certificate management
- Custom cipher suites
- Client certificate validation (mTLS)
- HTTP to HTTPS redirect
- Production best practices
- Troubleshooting TLS issues

---

## ⚙️ Core Features

### [Load Balancing Guide](./LOAD_BALANCING.md)

Master the 8+ load balancing strategies and optimize traffic distribution across your backend servers.

**Perfect for:** High availability, performance optimization, scaling

**Contents:**

- Load balancing strategies (round-robin, least-connections, weighted, IP hash, random, P2C, latency, weighted-least-connections)
- Health checks and circuit breakers
- Sticky sessions
- Performance comparison
- Advanced configuration
- Best practices

### [Clustering Guide](./CLUSTERING.md)

Scale horizontally with multi-process clustering for maximum CPU utilization and reliability.

**Perfect for:** High-traffic applications, horizontal scaling, zero-downtime deployments

**Contents:**

- Multi-process architecture
- Configuration options
- Lifecycle management
- Dynamic scaling (scale up/down)
- Zero-downtime rolling restarts
- Signal handling
- Worker management
- Monitoring clusters

---

## 📖 Reference

### [API Reference](./API_REFERENCE.md)

Complete API documentation with all configuration options, interfaces, and types.

**Perfect for:** Detailed configuration, TypeScript integration, advanced usage

**Contents:**

- BunGateway class and methods
- Configuration interfaces
- Route configuration
- Middleware API
- Logger API
- Types and type guards

### [Examples](./EXAMPLES.md)

Real-world examples and use cases demonstrating Bungate in action.

**Perfect for:** Learning by example, implementation patterns, architecture ideas

**Contents:**

- Microservices gateway
- E-commerce platform
- Multi-tenant SaaS
- API marketplace
- Content delivery (CDN-like)
- WebSocket gateway
- Development proxy
- Canary deployments

### [Troubleshooting Guide](./TROUBLESHOOTING.md)

Solutions to common issues, errors, and debugging techniques.

**Perfect for:** Solving problems, debugging, error resolution

**Contents:**

- Authentication issues
- Load balancing problems
- Performance issues
- Clustering issues
- TLS/HTTPS problems
- Common errors
- Debug mode
- Getting help

---

## 📊 Learning Paths

### For Beginners

1. **[Quick Start Guide](./QUICK_START.md)** - Learn the basics
2. **[Authentication Guide](./AUTHENTICATION.md)** - Secure your API
3. **[Examples](./EXAMPLES.md)** - See real-world use cases
4. **[Troubleshooting](./TROUBLESHOOTING.md)** - Solve common issues

### For Production Deployments

1. **[Security Guide](./SECURITY.md)** - Harden your gateway
2. **[TLS Configuration](./TLS_CONFIGURATION.md)** - Enable HTTPS
3. **[Load Balancing Guide](./LOAD_BALANCING.md)** - Distribute traffic
4. **[Clustering Guide](./CLUSTERING.md)** - Scale horizontally
5. **[API Reference](./API_REFERENCE.md)** - Fine-tune configuration

### For Advanced Users

1. **[API Reference](./API_REFERENCE.md)** - Master the API
2. **[Clustering Guide](./CLUSTERING.md)** - Advanced scaling
3. **[Load Balancing Guide](./LOAD_BALANCING.md)** - Optimize routing
4. **[Examples](./EXAMPLES.md)** - Complex architectures
5. **[Troubleshooting](./TROUBLESHOOTING.md)** - Debug like a pro

---

## 🎯 Quick References

### Common Tasks

| Task                           | Guide                                                         |
| ------------------------------ | ------------------------------------------------------------- |
| **Install and setup**          | [Quick Start](./QUICK_START.md)                               |
| **Add JWT authentication**     | [Authentication](./AUTHENTICATION.md#jwt-authentication)      |
| **Enable HTTPS**               | [TLS Configuration](./TLS_CONFIGURATION.md)                   |
| **Setup load balancing**       | [Load Balancing](./LOAD_BALANCING.md)                         |
| **Enable clustering**          | [Clustering](./CLUSTERING.md#basic-setup)                     |
| **Fix auth errors**            | [Troubleshooting](./TROUBLESHOOTING.md#authentication-issues) |
| **Configure security headers** | [Security Guide](./SECURITY.md#security-headers)              |
| **Add rate limiting**          | [Quick Start](./QUICK_START.md#adding-security)               |

### Configuration Examples

| Example                   | Location                                        |
| ------------------------- | ----------------------------------------------- |
| **Microservices gateway** | [Examples](./EXAMPLES.md#microservices-gateway) |
| **E-commerce platform**   | [Examples](./EXAMPLES.md#e-commerce-platform)   |
| **Multi-tenant SaaS**     | [Examples](./EXAMPLES.md#multi-tenant-saas)     |
| **API marketplace**       | [Examples](./EXAMPLES.md#api-marketplace)       |
| **WebSocket gateway**     | [Examples](./EXAMPLES.md#websocket-gateway)     |
| **Canary deployment**     | [Examples](./EXAMPLES.md#canary-deployments)    |

---

## 🔍 Search Tips

Use your browser's search (Ctrl/Cmd + F) within each guide to find specific topics:

- **Authentication**: Search for "JWT", "API key", "OAuth"
- **Load Balancing**: Search for strategy names like "round-robin", "least-connections"
- **Configuration**: Search for specific config keys like "timeout", "healthCheck"
- **Errors**: Search for error messages in [Troubleshooting](./TROUBLESHOOTING.md)

---

## 🌐 Additional Resources

### Official

- 🏠 **[GitHub Repository](https://github.com/BackendStack21/bungate)** - Source code
- 🌟 **[Landing Page](https://bungate.21no.de)** - Official website
- 📦 **[npm Package](https://www.npmjs.com/package/bungate)** - Package registry
- 🏗️ **[Examples Directory](../examples/)** - Working code samples
- 📊 **[Benchmark Results](../benchmark/)** - Performance benchmarks

### Community

- 💬 **[Discussions](https://github.com/BackendStack21/bungate/discussions)** - Ask questions, share ideas
- 🐛 **[Issues](https://github.com/BackendStack21/bungate/issues)** - Report bugs, request features
- 📖 **[Changelog](../CHANGELOG.md)** - Release notes (if available)
- 📝 **[Contributing](../CONTRIBUTING.md)** - Contribution guidelines (if available)

### Related Projects

- **[Bun](https://bun.sh)** - The JavaScript runtime Bungate is built on
- **[Pino](https://getpino.io)** - Fast logging library used by Bungate

---

## 📝 Documentation Feedback

Found an issue with the documentation? Have a suggestion?

- 🐛 **[Report Documentation Issues](https://github.com/BackendStack21/bungate/issues/new?labels=documentation)**
- 💡 **[Suggest Improvements](https://github.com/BackendStack21/bungate/discussions)**
- 🤝 **[Contribute](https://github.com/BackendStack21/bungate/pulls)** - Submit PRs to improve docs

---

## 📄 License

Bungate is MIT licensed. See [LICENSE](../LICENSE) for details.

---

<div align="center">

**Built with ❤️ by [21no.de](https://21no.de) for the JavaScript Community**

[🏠 Homepage](https://bungate.21no.de) | [📚 Docs](https://github.com/BackendStack21/bungate#readme) | [⭐ Star on GitHub](https://github.com/BackendStack21/bungate)

</div>
