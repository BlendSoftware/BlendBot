#!/usr/bin/env python3
"""
Parcha todos los archivos .py de pyafipws para compatibilidad con Python 3.
Uso:
  patch_setuppy.py <directorio>   # parchea todo el paquete
  patch_setuppy.py <archivo.py>   # modo legacy, solo ese archivo
"""
import os
import re
import sys


def fix_print_statements(content):
    """
    Reemplaza los print statements de Python 2 por llamadas Python 3.
    Procesa línea por línea para mayor precisión.
    """
    lines = content.split('\n')
    result = []
    
    for line in lines:
        original_line = line
        
        # 1. print(>> file, x  ->  print(x, file=file)
        m = re.match(r'^(\s*)print\s*\(\s*>>\s*([\w\.]+)\s*,\s*(.+)', line)
        if m:
            indent, target, rest = m.groups()
            rest = rest.rstrip()
            if rest.endswith(')'):
                rest = rest[:-1].rstrip()
            if rest:
                line = f'{indent}print({rest}, file={target})'
            else:
                line = f'{indent}print(file={target})'
            result.append(line)
            continue
        
        # 2. print >> file, x  ->  print(x, file=file)
        m = re.match(r'^(\s*)print\s*>>\s*([\w\.]+)\s*,\s*(.+)', line)
        if m:
            indent, target, rest = m.groups()
            rest = rest.rstrip()
            if rest:
                line = f'{indent}print({rest}, file={target})'
            else:
                line = f'{indent}print(file={target})'
            result.append(line)
            continue
        
        # 3. print X (statement sin paréntesis)
        # Solo si comienza con print seguido de espacio y NO paréntesis
        m = re.match(r'^(\s*)print\s+([^(].*)$', line)
        if m:
            indent, rest = m.groups()
            rest = rest.rstrip()
            if rest:
                line = f'{indent}print({rest})'
            else:
                line = f'{indent}print()'
            result.append(line)
            continue
        
        # 4. Caso especial: print solo al final de una línea (ej: if x: print y)
        # Buscar 'print ' que no sea al inicio de la línea
        if ' print ' in line and not line.strip().startswith('print('):
            # Buscar patrón como ': print X' o 'else: print X' 
            m = re.search(r'(\s+)print\s+(?![(\']print)([^#\n]+?)(\s*#.*)?$', line)
            if m:
                before_match = line[:m.start()]
                indent_in_match = m.group(1)
                content_to_print = m.group(2).rstrip()
                comment = m.group(3) if m.group(3) else ''
                line = f'{before_match}{indent_in_match}print({content_to_print}){comment}'
        
        result.append(line)
    
    return '\n'.join(result)


def patch_source_file(path):
    """Aplica fixes de Python 2->3 a un archivo .py cualquiera."""
    try:
        with open(path, errors="replace") as f:
            content = f.read()
    except Exception as e:
        print(f"  SKIP {path}: {e}")
        return

    original = content

    # 1. Expandir tabs (evita TabError)
    content = "\n".join(l.expandtabs(4) for l in content.split("\n"))

    # 2. Corregir print statements (cualquier posicion en la linea)
    content = fix_print_statements(content)

    # 3. except Foo, e:  ->  except Foo as e:
    content = re.sub(
        r'\bexcept\s+((?:\([\w\s,\.]+\)|[\w\.]+(?:\s*,\s*[\w\.]+)*))\s*,\s*(\w+)\s*:',
        lambda m: f'except {m.group(1).strip()} as {m.group(2).strip()}:',
        content,
    )

    # 4. raise Foo, "msg"  ->  raise Foo("msg")
    content = re.sub(r'\braise\s+(\w+)\s*,\s*"([^"]*)"', r'raise \1("\2")', content)
    content = re.sub(r"\braise\s+(\w+)\s*,\s*'([^']*)'", r"raise \1('\2')", content)

    # 5. basestring  ->  str
    content = re.sub(r'\bbasestring\b', 'str', content)

    # 6. unicode(  ->  str(
    content = re.sub(r'\bunicode\s*\(', 'str(', content)

    # 7. long(  ->  int(
    content = re.sub(r'\blong\s*\(', 'int(', content)

    # 8. from php import date  ->  # from php import date (comentar import invalido)
    content = re.sub(r'^(\s*)from php import date', r'\1# from php import date', content, flags=re.MULTILINE)

    # 9. Corregir imports relativos de pyafipws (from utils -> from pyafipws.utils)
    # Solo aplicar en archivos dentro del paquete pyafipws
    if 'pyafipws' in path or os.path.basename(path) in ['wsaa.py', 'wsfev1.py', 'wsfexv1.py']:
        # from utils import  ->  from pyafipws.utils import
        content = re.sub(r'^(\s*)from utils import', r'\1from pyafipws.utils import', content, flags=re.MULTILINE)
        # from pyfepdf import  ->  from pyafipws.pyfepdf import
        content = re.sub(r'^(\s*)from pyfepdf import', r'\1from pyafipws.pyfepdf import', content, flags=re.MULTILINE)

    # 10. Python 3: cStringIO -> io
    content = re.sub(r'^(\s*)from cStringIO import StringIO', r'\1from io import StringIO', content, flags=re.MULTILINE)
    content = re.sub(r'^(\s*)import cStringIO', r'\1import io', content, flags=re.MULTILINE)
    # Si se usaba cStringIO.StringIO() -> io.StringIO()
    content = re.sub(r'\bcStringIO\.StringIO\b', 'io.StringIO', content)

    # 11. Python 3: urllib reorganization
    content = re.sub(r'^(\s*)from urllib import urlencode', r'\1from urllib.parse import urlencode', content, flags=re.MULTILINE)
    content = re.sub(r'^(\s*)import urllib\b(?!\.)', r'\1import urllib.parse', content, flags=re.MULTILINE)
    # urllib.urlencode -> urllib.parse.urlencode
    content = re.sub(r'\burllib\.urlencode\b', 'urllib.parse.urlencode', content)

    # 12. Python 3: mimetools was removed, comment it out
    content = re.sub(r'^(\s*)import mimetools,', r'\1# import mimetools,  # Removed in Python 3', content, flags=re.MULTILINE)
    content = re.sub(r'^(\s*)import mimetools\b', r'\1# import mimetools  # Removed in Python 3', content, flags=re.MULTILINE)

    # 13. Python 3: HTMLParser moved to html.parser
    content = re.sub(r'^(\s*)from HTMLParser import HTMLParser', r'\1from html.parser import HTMLParser', content, flags=re.MULTILINE)
    content = re.sub(r'^(\s*)import HTMLParser\b', r'\1import html.parser as HTMLParser', content, flags=re.MULTILINE)

    # 14. Python 3: Cookie moved to http.cookies
    content = re.sub(r'^(\s*)from Cookie import SimpleCookie', r'\1from http.cookies import SimpleCookie', content, flags=re.MULTILINE)
    content = re.sub(r'^(\s*)import Cookie\b', r'\1import http.cookies as Cookie', content, flags=re.MULTILINE)

    # 15. Python 3: sys.exc_type/exc_value/exc_traceback removed
    # Replace sys.exc_type with sys.exc_info()[0], etc.
    content = re.sub(r'\bsys\.exc_type\b', 'sys.exc_info()[0]', content)
    content = re.sub(r'\bsys\.exc_value\b', 'sys.exc_info()[1]', content)
    content = re.sub(r'\bsys\.exc_traceback\b', 'sys.exc_info()[2]', content)

    # 16. Python 3: Hashing requires bytes - fix common hash patterns
    # Fix: hashlib.md5("string") -> hashlib.md5("string".encode())
    # Fix: hashlib.sha1("string") -> hashlib.sha1("string".encode())
    # Captura hashlib.ALGO("string_literal") o hashlib.ALGO('string_literal')
    content = re.sub(
        r'\bhashlib\.(md5|sha1|sha256|sha512)\((["\'])([^"\']+)\2\)',
        r'hashlib.\1(\2\3\2.encode())',
        content
    )
    # Fix: hashlib.ALGO(variable) donde variable podria ser string
    # Patron mas conservador para no romper bytes existentes
    content = re.sub(
        r'\bhashlib\.(md5|sha1|sha256|sha512)\(([a-zA-Z_]\w*)\)(?!\s*\.)',
        r'hashlib.\1(\2.encode() if isinstance(\2, str) else \2)',
        content
    )

    # 17. Python 3: operaciones .update() de hash necesitan bytes
    # Fix: hash_obj.update("string") -> hash_obj.update("string".encode())
    content = re.sub(
        r'\.update\((["\'])([^"\']*)\1\)',
        r'.update(\1\2\1.encode())',
        content
    )
    # Fix: .update(variable) -> .update(variable.encode() if isinstance(variable, str) else variable)
    content = re.sub(
        r'\.update\(([a-zA-Z_]\w*)\)(?!\s*\.)',
        r'.update(\1.encode() if isinstance(\1, str) else \1)',
        content
    )

    # 18. Python 3: operaciones de firma digital con M2Crypto
    # Fix: sign_update(data) necesita bytes
    content = re.sub(
        r'\.sign_update\((["\'])([^"\']*)\1\)',
        r'.sign_update(\1\2\1.encode())',
        content
    )
    content = re.sub(
        r'\.sign_update\(([a-zA-Z_]\w*)\)',
        r'.sign_update(\1.encode() if isinstance(\1, str) else \1)',
        content
    )

    # 19. Python 3: Parche ESPECÍFICO para date() PHP en wsaa.py
    # Este archivo tiene casos complejos que el regex general no maneja bien
    if 'wsaa' in path.lower() or os.path.basename(path) == 'wsaa.py':
        # PASO 1: Limpiar .isoformat() mal colocado en time.time()
        # Esto corrige el bug: time.time().isoformat() -> time.time()
        content = content.replace('time.time().isoformat()', 'time.time()')
        content = content.replace('time.time() .isoformat()', 'time.time()')
        content = content.replace('time.time( ).isoformat()', 'time.time()')
        
        # PASO 2: Corregir patrones mal formados en add_child
        # Bug original: int(time.time().isoformat())-ttl
        # Debe ser: int(time.time())-ttl dentro de fromtimestamp, y .isoformat() al final
        
        # Patrón más flexible para generationTime (captura con o sin .isoformat mal colocado)
        content = re.sub(
            r"tra\.header\.add_child\s*\(\s*['\"]generationTime['\"]\s*,\s*str\s*\(\s*datetime\.datetime\.fromtimestamp\s*\(\s*int\s*\(\s*time\.time\s*\(\s*\)\s*(?:\.isoformat\(\))?\s*\)\s*-\s*ttl\s*\)\s*(?:\.isoformat\(\))?\s*\)\s*\)",
            "tra.header.add_child('generationTime', str(datetime.datetime.fromtimestamp(int(time.time())-ttl).isoformat()))",
            content
        )
        
        # Patrón para expirationTime
        content = re.sub(
            r"tra\.header\.add_child\s*\(\s*['\"]expirationTime['\"]\s*,\s*str\s*\(\s*datetime\.datetime\.fromtimestamp\s*\(\s*int\s*\(\s*time\.time\s*\(\s*\)\s*(?:\.isoformat\(\))?\s*\)\s*\+\s*ttl\s*\)\s*(?:\.isoformat\(\))?\s*\)\s*\)",
            "tra.header.add_child('expirationTime', str(datetime.datetime.fromtimestamp(int(time.time())+ttl).isoformat()))",
            content
        )
        
        # uniqueId solo necesita el timestamp como entero
        content = re.sub(
            r"tra\.header\.add_child\s*\(\s*['\"]uniqueId['\"]\s*,\s*str\s*\(\s*int\s*\(\s*time\.time\s*\(\s*\)\s*(?:\.isoformat\(\))?\s*\)\s*\)\s*\)",
            "tra.header.add_child('uniqueId', str(int(time.time())))",
            content
        )
        
        # Asegurar imports en wsaa.py
        if 'datetime.datetime.fromtimestamp' in content or 'int(time.time())' in content:
            if not re.search(r'^import time\b', content, re.MULTILINE):
                lines = content.split('\n')
                for i, line in enumerate(lines):
                    if line.strip().startswith('import ') or line.strip().startswith('from '):
                        lines.insert(i, 'import time')
                        break
                content = '\n'.join(lines)
            if not re.search(r'^import datetime\b', content, re.MULTILINE):
                lines = content.split('\n')
                for i, line in enumerate(lines):
                    if line.strip().startswith('import ') or line.strip().startswith('from '):
                        lines.insert(i, 'import datetime')
                        break
                content = '\n'.join(lines)

    # 19b. Python 3: date() viene de código PHP - manejar diferentes formatos PHP (GENÉRICO)
    # ORDEN IMPORTANTE: aplicar de más específico a más general
    
    # 19b.1. date('U') -> int(time.time())  (timestamp Unix)
    content = re.sub(r"\b(datetime\.)?date\s*\(\s*['\"]U['\"]\s*\)", "int(time.time())", content)
    
    # 19b.2. date('c', X) -> datetime.datetime.fromtimestamp(X).isoformat()
    # Patrón no-greedy para capturar solo el timestamp, soportando paréntesis simples
    content = re.sub(
        r"\b(datetime\.)?date\s*\(\s*['\"]c['\"]\s*,\s*([^)]+?)\s*\)",
        r"datetime.datetime.fromtimestamp(\2).isoformat()",
        content
    )
    
    # 19b.3. date('Y', X) -> datetime.datetime.fromtimestamp(X).strftime('%Y')
    content = re.sub(
        r"\b(datetime\.)?date\s*\(\s*['\"]Y['\"]\s*,\s*([^)]+?)\s*\)",
        r"datetime.datetime.fromtimestamp(\2).strftime('%Y')",
        content
    )
    
    # 19b.4. Lista de formatos PHP comunes
    php_formats = {
        'Y': '%Y',  # Year 4 digits
        'm': '%m',  # Month 2 digits
        'd': '%d',  # Day 2 digits
        'H': '%H',  # Hour 24
        'i': '%M',  # Minutes
        's': '%S',  # Seconds
    }
    
    # Para cada formato simple, hacer el reemplazo
    for php_fmt, python_fmt in php_formats.items():
        pattern = rf"\b(datetime\.)?date\s*\(\s*['\"]{php_fmt}['\"]\s*,\s*([^)]+?)\s*\)"
        repl = rf"datetime.datetime.fromtimestamp(\2).strftime('{python_fmt}')"
        content = re.sub(pattern, repl, content)
    
    # Asegurar imports necesarios (para casos generales)
    needs_time = 'int(time.time())' in content
    needs_datetime = 'datetime.datetime.fromtimestamp' in content
    
    if needs_time or needs_datetime:
        has_time_import = re.search(r'^import time\b', content, re.MULTILINE)
        has_datetime_import = re.search(r'^import datetime\b', content, re.MULTILINE)
        
        lines = content.split('\n')
        imports_to_add = []
        
        if needs_time and not has_time_import:
            imports_to_add.append('import time')
        if needs_datetime and not has_datetime_import:
            imports_to_add.append('import datetime')
        
        if imports_to_add:
            # Encontrar la primera línea de import
            for i, line in enumerate(lines):
                stripped = line.strip()
                if (stripped.startswith('import ') or stripped.startswith('from ')) and not stripped.startswith('#'):
                    # Insertar todos los imports necesarios
                    for imp in reversed(imports_to_add):
                        lines.insert(i, imp)
                    content = '\n'.join(lines)
                    break

    # 20. Python 3: Asegurar que date esté importado o usar datetime.date PARA OTROS CASOS
    # Estrategia: si se usa date() sin import, cambiar a datetime.date() y asegurar import datetime
    if re.search(r'\bdate\s*\(', content):
        # Verificar si ya existe un import de date
        has_date_import = re.search(r'^from datetime import.*\bdate\b', content, re.MULTILINE)
        has_datetime_import = re.search(r'^import datetime\b', content, re.MULTILINE)
        
        if not has_date_import:
            # Reemplazar date( con datetime.date(
            content = re.sub(r'\bdate\s*\(', 'datetime.date(', content)
            
            # Asegurar que datetime esté importado
            if not has_datetime_import:
                # Buscar el primer import existente
                lines = content.split('\n')
                insert_idx = 0
                for i, line in enumerate(lines):
                    stripped = line.strip()
                    if (stripped.startswith('import ') or stripped.startswith('from ')) and not stripped.startswith('#'):
                        insert_idx = i
                        break
                
                # Insertar antes del primer import encontrado
                if insert_idx > 0:
                    lines.insert(insert_idx, 'import datetime')
                    content = '\n'.join(lines)

    if content != original:
        with open(path, "w") as f:
            f.write(content)
        print(f"  Patched: {os.path.basename(path)}")


def patch_setup_py(path):
    """Parchea setup.py con correcciones especificas para la instalacion."""
    with open(path, errors="replace") as f:
        content = f.read()

    # Expandir tabs
    content = "\n".join(l.expandtabs(4) for l in content.split("\n"))

    # print statements
    content = fix_print_statements(content)

    # Vaciar scripts=[...] - los archivos referenciados no existen
    content = re.sub(r"scripts\s*=\s*\[[^\]]*\]", "scripts=[]", content, flags=re.DOTALL)

    with open(path, "w") as f:
        f.write(content)
    print(f"  Patched: setup.py")


arg = sys.argv[1]

if os.path.isdir(arg):
    print(f"Patching directory: {arg}")
    for fname in sorted(os.listdir(arg)):
        fpath = os.path.join(arg, fname)
        if not os.path.isfile(fpath) or not fname.endswith('.py'):
            continue
        if fname == 'setup.py':
            patch_setup_py(fpath)
        else:
            patch_source_file(fpath)
    print("Done patching directory.")
else:
    # Modo legacy: se le pasa un unico archivo
    patch_setup_py(arg)
    print(f"Patched {arg} OK")
