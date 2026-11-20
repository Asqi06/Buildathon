import re

with open('public/console.js', 'r', encoding='utf-8') as f:
    text = f.read()

single = re.findall(r"\$\(['\"]([^'\"]+)['\"]\)", text)
multi = re.findall(r"\$\$\(['\"]([^'\"]+)['\"]\)", text)

print("Single selectors ($):")
for s in sorted(set(single)):
    print(f"  {s}")

print("\nMulti selectors ($$):")
for s in sorted(set(multi)):
    print(f"  {s}")
