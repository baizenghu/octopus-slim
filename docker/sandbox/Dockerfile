FROM docker.m.daocloud.io/library/ubuntu:22.04

# 避免交互式 debconf 提示
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Shanghai

# ------------------------------------------------------------------
# 切换到国内 APT 镜像（阿里云），不依赖外网代理
# ------------------------------------------------------------------
RUN sed -i \
        -e 's|http://archive.ubuntu.com/ubuntu|http://mirrors.aliyun.com/ubuntu|g' \
        -e 's|http://security.ubuntu.com/ubuntu|http://mirrors.aliyun.com/ubuntu|g' \
    /etc/apt/sources.list

# ------------------------------------------------------------------
# 系统基础工具
# ------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        jq \
        gnupg \
        software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------
# Python 3.11（使用清华 PPA 镜像）
# deadsnakes PPA 内网不一定可达，改用 ubuntu 官方 22.04 自带 python3.11
# 22.04 默认 python3 = 3.10；用 deadsnakes 获取 3.11
# ------------------------------------------------------------------
RUN add-apt-repository ppa:deadsnakes/ppa -y \
    && apt-get update && apt-get install -y --no-install-recommends \
        python3.11 \
        python3.11-distutils \
        python3.11-dev \
        python3-pip \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python  python  /usr/bin/python3.11 1 \
    && rm -rf /var/lib/apt/lists/*

# pip 升级（使用清华镜像）
RUN python3 -m pip install --upgrade pip \
        -i https://pypi.tuna.tsinghua.edu.cn/simple \
        --trusted-host pypi.tuna.tsinghua.edu.cn

# MySQL / PostgreSQL 系统开发库（编译 mysqlclient / psycopg2 需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
        default-libmysqlclient-dev \
        libpq-dev \
        pkg-config \
        gcc \
    && rm -rf /var/lib/apt/lists/*

# 数据科学 + 数据库驱动（固定版本，使用清华 PyPI 镜像）
RUN pip install --no-cache-dir \
        pandas==2.2.0 \
        numpy==1.26.0 \
        scipy==1.12.0 \
        matplotlib==3.8.0 \
        seaborn==0.13.0 \
        openpyxl==3.1.2 \
        PyMySQL==1.1.0 \
        mysqlclient==2.2.4 \
        psycopg2-binary==2.9.9 \
        python-pptx==1.0.2 \
        -i https://pypi.tuna.tsinghua.edu.cn/simple \
        --trusted-host pypi.tuna.tsinghua.edu.cn

# ------------------------------------------------------------------
# Node.js 20 LTS（nodesource 可直连）
# ------------------------------------------------------------------
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------
# 用户与目录
# sandbox 用户: uid=2000, gid=2000，非 root 执行
# 使用 uid=2000 而非 1000，避免与宿主机 baizh(uid=1000) 相同
# 相同 uid 会导致 bind mount 的 skills 目录权限检查失效
# /workspace  属于 sandbox（读写）
# /opt/skills 属于 root，权限 700（用户不可读）
# ------------------------------------------------------------------
RUN groupadd --gid 2000 sandbox \
    && useradd --uid 2000 --gid 2000 --no-create-home --shell /bin/bash sandbox

RUN mkdir -p /workspace \
    && chown sandbox:sandbox /workspace \
    && chmod 755 /workspace

RUN mkdir -p /opt/skills \
    && chown root:root /opt/skills \
    && chmod 700 /opt/skills

# ------------------------------------------------------------------
# 运行时设置
# ------------------------------------------------------------------
WORKDIR /workspace
USER sandbox

CMD ["/bin/bash"]
