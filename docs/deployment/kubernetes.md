# Kubernetes 部署指南

本指南说明如何在 Kubernetes 集群中部署 OpenClaw。

## 前置条件

- 已安装 kubectl 1.24+
- 已配置 Kubernetes 集群（1.24+）
- 已安装 Helm 3.0+（可选）
- 已配置容器镜像仓库（Docker Hub、ECR、ACR 等）

## 部署架构

```
┌─────────────────────────────��───────────────────────┐
│                  Kubernetes Cluster                  │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────────────────────────────────────────┐   │
│  │         Ingress Controller (Nginx)           │   │
│  └──────────────────────────────────────────────┘   │
│                      ↓                               │
│  ┌──────────────────────────────────────────────┐   │
│  │  Service: openclaw-frontend (ClusterIP)      │   │
│  │  Service: openclaw-backend (ClusterIP)       │   │
│  └──────────────────────────────────────────────┘   │
│           ↓                        ↓                 │
│  ┌──────────────────┐    ┌──────────────────┐       │
│  │ Frontend Pod(s)  │    │ Backend Pod(s)   │       │
│  │ (Nginx)          │    │ (Node.js)        │       │
│  └──────────────────┘    └──────────────────┘       │
│                               ↓                      │
│                    ┌──────────────────┐              │
│                    │  PersistentVolume│              │
│                    │  (Data Storage)  │              │
│                    └──────────────────┘              │
│                                                       │
└─────────────────────────────────────────────────────┘
```

## 创建 Kubernetes 清单

### 1. Namespace

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: openclaw
  labels:
    name: openclaw
```

### 2. ConfigMap（配置）

```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: openclaw-config
  namespace: openclaw
data:
  NODE_ENV: "production"
  PORT: "3000"
  LOG_LEVEL: "info"
  API_BASE_URL: "https://api.example.com"
  FRONTEND_URL: "https://example.com"
  CORS_ORIGIN: "https://example.com"
  VITE_API_BASE_URL: "https://api.example.com"
  VITE_APP_TITLE: "OpenClaw"
```

### 3. Secret（敏感信息）

```yaml
# k8s/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: openclaw-secret
  namespace: openclaw
type: Opaque
stringData:
  JWT_SECRET: "your-secure-random-secret-here-min-32-chars"
  DATABASE_URL: "postgresql://user:password@postgres:5432/openclaw"
```

**创建 Secret 的安全方式：**

```bash
# 使用 kubectl 创建
kubectl create secret generic openclaw-secret \
  --from-literal=JWT_SECRET=$(openssl rand -base64 32) \
  --from-literal=DATABASE_URL="postgresql://user:password@postgres:5432/openclaw" \
  -n openclaw

# 或使用文件
kubectl create secret generic openclaw-secret \
  --from-file=.env \
  -n openclaw
```

### 4. PersistentVolume 和 PersistentVolumeClaim

```yaml
# k8s/storage.yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: openclaw-pv
spec:
  capacity:
    storage: 50Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: standard
  hostPath:
    path: /data/openclaw

---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: openclaw-pvc
  namespace: openclaw
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: standard
  resources:
    requests:
      storage: 50Gi
```

### 5. 后端 Deployment

```yaml
# k8s/backend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openclaw-backend
  namespace: openclaw
  labels:
    app: openclaw-backend
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: openclaw-backend
  template:
    metadata:
      labels:
        app: openclaw-backend
    spec:
      serviceAccountName: openclaw
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000

      containers:
      - name: backend
        image: your-registry/openclaw-backend:latest
        imagePullPolicy: Always
        ports:
        - name: http
          containerPort: 3000
          protocol: TCP
        - name: metrics
          containerPort: 9090
          protocol: TCP

        envFrom:
        - configMapRef:
            name: openclaw-config
        - secretRef:
            name: openclaw-secret

        env:
        - name: NODE_OPTIONS
          value: "--max-old-space-size=2048"

        resources:
          requests:
            cpu: 250m
            memory: 512Mi
          limits:
            cpu: 1000m
            memory: 2Gi

        livenessProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3

        readinessProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3

        volumeMounts:
        - name: data
          mountPath: /data
        - name: logs
          mountPath: /logs

        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL

      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: openclaw-pvc
      - name: logs
        emptyDir: {}

      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - openclaw-backend
              topologyKey: kubernetes.io/hostname
```

### 6. 后端 Service

```yaml
# k8s/backend-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: openclaw-backend
  namespace: openclaw
  labels:
    app: openclaw-backend
spec:
  type: ClusterIP
  ports:
  - name: http
    port: 3000
    targetPort: http
    protocol: TCP
  - name: metrics
    port: 9090
    targetPort: metrics
    protocol: TCP
  selector:
    app: openclaw-backend
  sessionAffinity: None
```

### 7. 前端 Deployment

```yaml
# k8s/frontend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openclaw-frontend
  namespace: openclaw
  labels:
    app: openclaw-frontend
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: openclaw-frontend
  template:
    metadata:
      labels:
        app: openclaw-frontend
    spec:
      serviceAccountName: openclaw
      securityContext:
        runAsNonRoot: true
        runAsUser: 101
        fsGroup: 101

      containers:
      - name: frontend
        image: your-registry/openclaw-frontend:latest
        imagePullPolicy: Always
        ports:
        - name: http
          containerPort: 80
          protocol: TCP

        envFrom:
        - configMapRef:
            name: openclaw-config

        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 500m
            memory: 512Mi

        livenessProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3

        readinessProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3

        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL

      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - openclaw-frontend
              topologyKey: kubernetes.io/hostname
```

### 8. 前端 Service

```yaml
# k8s/frontend-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: openclaw-frontend
  namespace: openclaw
  labels:
    app: openclaw-frontend
spec:
  type: ClusterIP
  ports:
  - name: http
    port: 80
    targetPort: http
    protocol: TCP
  selector:
    app: openclaw-frontend
```

### 9. Ingress

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: openclaw-ingress
  namespace: openclaw
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - example.com
    - api.example.com
    secretName: openclaw-tls
  rules:
  - host: example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: openclaw-frontend
            port:
              number: 80
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: openclaw-backend
            port:
              number: 3000
  - host: api.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: openclaw-backend
            port:
              number: 3000
```

### 10. ServiceAccount 和 RBAC

```yaml
# k8s/rbac.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: openclaw
  namespace: openclaw

---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: openclaw
  namespace: openclaw
rules:
- apiGroups: [""]
  resources: ["configmaps"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get"]

---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: openclaw
  namespace: openclaw
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: openclaw
subjects:
- kind: ServiceAccount
  name: openclaw
  namespace: openclaw
```

## 部署步骤

### 1. 创建 Namespace

```bash
kubectl apply -f k8s/namespace.yaml
```

### 2. 创建 ConfigMap 和 Secret

```bash
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
```

### 3. 创建存储

```bash
kubectl apply -f k8s/storage.yaml
```

### 4. 创建 RBAC

```bash
kubectl apply -f k8s/rbac.yaml
```

### 5. 部署应用

```bash
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/backend-service.yaml
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/frontend-service.yaml
```

### 6. 配置 Ingress

```bash
# 安装 Nginx Ingress Controller（如未安装）
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install nginx-ingress ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

# 安装 Cert-Manager（如未安装）
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set installCRDs=true

# 创建 ClusterIssuer
kubectl apply -f - << 'EOF'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF

# 部署 Ingress
kubectl apply -f k8s/ingress.yaml
```

## 验证部署

```bash
# 检查 Pod 状态
kubectl get pods -n openclaw

# 检查 Service
kubectl get svc -n openclaw

# 检查 Ingress
kubectl get ingress -n openclaw

# 查看 Pod 日志
kubectl logs -n openclaw -l app=openclaw-backend -f

# 进入 Pod
kubectl exec -it -n openclaw <pod-name> -- /bin/sh

# 检查事件
kubectl describe pod -n openclaw <pod-name>
```

## 扩展和更新

### 手动扩展

```bash
# 扩展后端副本
kubectl scale deployment openclaw-backend -n openclaw --replicas=5

# 扩展前端副本
kubectl scale deployment openclaw-frontend -n openclaw --replicas=3
```

### 自动扩展（HPA）

```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: openclaw-backend-hpa
  namespace: openclaw
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: openclaw-backend
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### 滚动更新

```bash
# 更新镜像
kubectl set image deployment/openclaw-backend \
  backend=your-registry/openclaw-backend:v1.1.0 \
  -n openclaw

# 查看更新进度
kubectl rollout status deployment/openclaw-backend -n openclaw

# 回滚更新
kubectl rollout undo deployment/openclaw-backend -n openclaw
```

## 监控和日志

### Prometheus 监控

```yaml
# k8s/prometheus-servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: openclaw-backend
  namespace: openclaw
spec:
  selector:
    matchLabels:
      app: openclaw-backend
  endpoints:
  - port: metrics
    interval: 30s
```

### 日志收集（ELK Stack）

```bash
# 安装 Filebeat
helm repo add elastic https://helm.elastic.co
helm install filebeat elastic/filebeat \
  --namespace openclaw \
  -f filebeat-values.yaml
```

## 故障排查

### Pod 无法启动

```bash
# 查看 Pod 事件
kubectl describe pod -n openclaw <pod-name>

# 查看 Pod 日志
kubectl logs -n openclaw <pod-name>

# 检查资源限制
kubectl top pod -n openclaw
```

### 服务无法访问

```bash
# 检查 Service 端点
kubectl get endpoints -n openclaw

# 测试 Service 连接
kubectl run -it --rm debug --image=busybox --restart=Never -- \
  wget -O- http://openclaw-backend:3000/health
```

### 存储问题

```bash
# 检查 PVC 状态
kubectl get pvc -n openclaw

# 检查 PV 状态
kubectl get pv

# 查看存储使用
kubectl exec -it -n openclaw <pod-name> -- df -h
```
