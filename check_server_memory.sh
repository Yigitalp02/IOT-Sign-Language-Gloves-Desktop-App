#!/bin/bash
# Quick script to check what's using memory on your server

echo "=========================================="
echo "Top 15 Memory Consumers (Processes)"
echo "=========================================="
ps aux --sort=-%mem | head -16

echo ""
echo "=========================================="
echo "Docker Container Memory Usage"
echo "=========================================="
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"

echo ""
echo "=========================================="
echo "Memory Breakdown"
echo "=========================================="
free -h

echo ""
echo "=========================================="
echo "System Memory Summary"
echo "=========================================="
echo "Total:     $(free -h | awk '/^Mem:/ {print $2}')"
echo "Used:      $(free -h | awk '/^Mem:/ {print $3}')"
echo "Available: $(free -h | awk '/^Mem:/ {print $7}')"
echo "Swap Used: $(free -h | awk '/^Swap:/ {print $3}')"

echo ""
echo "=========================================="
echo "Likely Culprits (Based on Your Setup)"
echo "=========================================="
echo "Common memory hogs:"
echo "- Minecraft Server: 1-4GB typically"
echo "- LocalAI/LLM: 2-8GB+ depending on model"
echo "- PostgreSQL databases: 500MB-2GB total"
echo "- Your various Docker services"
echo ""
echo "Tip: If swap is high, you may want to:"
echo "1. Stop unused services temporarily"
echo "2. Reduce Java heap for Minecraft (-Xmx)"
echo "3. Reduce LLM model size or context length"

