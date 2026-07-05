#!/usr/bin/env python3
"""Expand all maps so camera zoom ~17 tiles fills the screen on portrait phones."""
import json, random, os

random.seed(42)
BASE = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')

def load(name):
    with open(os.path.join(BASE, 'maps', f'{name}.json')) as f:
        return json.load(f)

def save(name, d):
    with open(os.path.join(BASE, 'maps', f'{name}.json'), 'w') as f:
        json.dump(d, f)

def expand(d, tw, th, ox, oy, fill_f, fill_c):
    ow, oh = d['width'], d['height']
    nf = [[fill_f]*tw for _ in range(th)]
    nc = [[fill_c]*tw for _ in range(th)]
    for y in range(oh):
        for x in range(ow):
            nf[y+oy][x+ox] = d['layers']['floor'][y][x]
            nc[y+oy][x+ox] = d['layers']['collision'][y][x]
    d['width'], d['height'] = tw, th
    d['layers']['floor'], d['layers']['collision'] = nf, nc
    d['playerStart']['x'] += ox
    d['playerStart']['y'] += oy
    for w in d.get('warps',[]): w['x'] += ox; w['y'] += oy
    for b in d.get('buildings',[]): b['x'] += ox; b['y'] += oy

# --- Load ---
maps = {n: load(n) for n in ['moonbase','sand_route_1','crater_city','gym_1']}
trainers = json.load(open(os.path.join(BASE, 'trainers.json')))

# Offsets for each map
OFF = {
    'moonbase':     (24, 28, 2, 2),
    'sand_route_1': (30, 28, 0, 4),
    'crater_city':  (28, 28, 1, 4),
    'gym_1':        (20, 28, 2, 8),
}

# --- Expand grids ---
expand(maps['moonbase'],     24, 28, 2, 2,  1, 1)   # walls
expand(maps['sand_route_1'], 30, 28, 0, 4,  5, 0)   # sand
expand(maps['crater_city'],  28, 28, 1, 4, 11, 0)   # road
expand(maps['gym_1'],        20, 28, 2, 8, 10, 0)   # gym floor

# --- Shift trainers ---
for t in trainers:
    spec = OFF.get(t['mapKey'])
    if spec:
        _, _, ox, oy = spec
        t['x'] += ox
        t['y'] += oy

# ===================== MOONBASE (24x28) =====================
d = maps['moonbase']
F, C = d['layers']['floor'], d['layers']['collision']

# Corridor from old exit (y=16) down to y=26
for y in range(17, 27):
    for x in range(9, 15):   # 6-wide corridor
        F[y][x] = 0; C[y][x] = 0
    # Equipment stations along corridor walls every 3 rows
    if y % 3 == 0:
        F[y][8] = 2; C[y][8] = 1  # equipment left
        F[y][15] = 2; C[y][15] = 1  # equipment right

# Bottom exit wall
for x in range(24):
    F[27][x] = 1; C[27][x] = 1
F[27][11] = 9; C[27][11] = 0   # door
F[27][12] = 9; C[27][12] = 0

# Extra rooms on sides of corridor
# Left room (y=19-22, x=3-7)
for y in range(19,23):
    for x in range(3,8):
        F[y][x] = 0; C[y][x] = 0
for x in range(3,8):
    F[18][x] = 1; C[18][x] = 1  # top wall
    F[23][x] = 1; C[23][x] = 1  # bottom wall
F[18][5] = 0; C[18][5] = 0  # doorway
for y in range(18,24):
    F[y][2] = 1; C[y][2] = 1  # left wall
F[20][4] = 3; C[20][4] = 1  # console
F[21][6] = 2; C[21][6] = 1  # equipment

# Right room (y=19-22, x=17-21)
for y in range(19,23):
    for x in range(17,22):
        F[y][x] = 0; C[y][x] = 0
for x in range(17,22):
    F[18][x] = 1; C[18][x] = 1
    F[23][x] = 1; C[23][x] = 1
F[18][19] = 0; C[18][19] = 0  # doorway
for y in range(18,24):
    F[y][22] = 1; C[y][22] = 1
F[20][18] = 4; C[20][18] = 1  # central device
F[21][20] = 3; C[21][20] = 1  # console

# Set warps
d['warps'] = [
    {'x':11,'y':27,'targetMap':'sand_route_1','targetX':14,'targetY':1},
    {'x':12,'y':27,'targetMap':'sand_route_1','targetX':15,'targetY':1},
]

# ===================== SAND_ROUTE_1 (30x28) =====================
d = maps['sand_route_1']
F, C = d['layers']['floor'], d['layers']['collision']

# Fill expanded rows (0-3 and 24-27) with terrain variety
for y in list(range(0,4)) + list(range(24,28)):
    for x in range(30):
        r = random.random()
        if r < 0.08:
            F[y][x] = 6; C[y][x] = 1   # rock
        elif r < 0.14:
            F[y][x] = 7; C[y][x] = 1   # crater
        else:
            F[y][x] = random.choice([5,5,5,5,32,33,34,35])
            C[y][x] = 0

# Clear warp tiles
for x in [14,15]:
    for y in [0,1]:
        F[y][x] = 5; C[y][x] = 0
    for y in [26,27]:
        F[y][x] = 5; C[y][x] = 0

# Add rocks forming path edges in expanded top area
for x in [12,17]:
    for y in range(0,4):
        if random.random() < 0.5:
            F[y][x] = 6; C[y][x] = 1

d['warps'] = [
    {'x':14,'y':0,'targetMap':'moonbase','targetX':11,'targetY':26},
    {'x':15,'y':0,'targetMap':'moonbase','targetX':12,'targetY':26},
    {'x':14,'y':27,'targetMap':'crater_city','targetX':13,'targetY':1},
    {'x':15,'y':27,'targetMap':'crater_city','targetX':14,'targetY':1},
]

# ===================== CRATER_CITY (28x28) =====================
d = maps['crater_city']
F, C = d['layers']['floor'], d['layers']['collision']

# Fill expanded areas with mixed road/sand
for y in list(range(0,4)) + list(range(24,28)):
    for x in range(28):
        F[y][x] = 11 if random.random() > 0.3 else 5
        C[y][x] = 0
# Right side expansion
for y in range(28):
    for x in range(26,28):
        if C[y][x] == 1: continue  # keep existing collision
        F[y][x] = 11; C[y][x] = 0

# Clear warp areas
for y in [0,1]:
    for x in [13,14]: F[y][x] = 11; C[y][x] = 0
for y in [13,14]:
    for x in [26,27]: F[y][x] = 9; C[y][x] = 0  # doors to gym

d['warps'] = [
    {'x':13,'y':0,'targetMap':'sand_route_1','targetX':14,'targetY':26},
    {'x':14,'y':0,'targetMap':'sand_route_1','targetX':15,'targetY':26},
    {'x':27,'y':13,'targetMap':'gym_1','targetX':1,'targetY':16},
    {'x':27,'y':14,'targetMap':'gym_1','targetX':1,'targetY':17},
]

# ===================== GYM_1 (20x28) =====================
d = maps['gym_1']
F, C = d['layers']['floor'], d['layers']['collision']

# Walls around entire border
for x in range(20):
    F[0][x]=1; C[0][x]=1; F[27][x]=1; C[27][x]=1
for y in range(28):
    F[y][0]=1; C[y][0]=1; F[y][19]=1; C[y][19]=1

# Entry doors on left wall
F[16][0]=9; C[16][0]=0
F[17][0]=9; C[17][0]=0

# Gym battle arena lines (decorative walls)
for x in range(4,16):
    F[12][x]=1; C[12][x]=1  # top line
    F[22][x]=1; C[22][x]=1  # bottom line
for y in range(12,23):
    F[y][4]=1; C[y][4]=1    # left line
    F[y][15]=1; C[y][15]=1  # right line
# Arena openings
F[12][9]=10; C[12][9]=0; F[12][10]=10; C[12][10]=0  # top entrance
F[22][9]=10; C[22][9]=0; F[22][10]=10; C[22][10]=0  # bottom entrance
F[17][4]=10; C[17][4]=0   # left opening
F[17][15]=10; C[17][15]=0  # right opening

d['warps'] = [
    {'x':0,'y':16,'targetMap':'crater_city','targetX':26,'targetY':13},
    {'x':0,'y':17,'targetMap':'crater_city','targetX':26,'targetY':14},
]

# ===================== SAVE ALL =====================
for name, data in maps.items():
    save(name, data)
    print(f'{name}: {data["width"]}x{data["height"]} start=({data["playerStart"]["x"]},{data["playerStart"]["y"]})')

json.dump(trainers, open(os.path.join(BASE, 'trainers.json'), 'w'))
print('Trainers updated')
print('Done!')
